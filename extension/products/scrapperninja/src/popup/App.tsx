/**
 * ScrapperNinja popup — capture control surface.
 *
 * The popup is stateless UI: it renders the CaptureStatus the service worker
 * reports and sends it commands. All capture state and the offline queue live
 * in the worker, so closing the popup never interrupts a run.
 *
 * Controls: sign-in gate, required campaign picker (select or create),
 * Fast/Deep, pacing, per-run cap with "keep going", Start/Stop, live counters,
 * a tier-d warning, and single-page manual capture.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  api,
  API_ORIGIN,
  clearToken,
  getToken,
  SignInRequiredError,
} from "../../../../shared/api";
import type {
  CaptureMode,
  CaptureStatus,
  CommandResult,
  Pacing,
  PopupCommand,
} from "../lib/commands";

interface Campaign {
  id: string;
  name: string;
  status?: string;
}

type Screen = "loading" | "signed-out" | "ready";

const CAP_STEP = 200;

function sendCommand(command: PopupCommand): Promise<CommandResult> {
  return chrome.runtime.sendMessage(command) as Promise<CommandResult>;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [newCampaign, setNewCampaign] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<CaptureMode>("fast");
  const [pacing, setPacing] = useState<Pacing>("normal");
  const [cap, setCap] = useState(CAP_STEP);
  const [busy, setBusy] = useState<null | "start" | "stop" | "manual" | "sync">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await sendCommand({ cmd: "GET_STATUS" });
      setStatus(result.status);
    } catch {
      // Worker may be waking up; the next poll will catch it.
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await getToken();
      } catch (err) {
        setScreen(err instanceof SignInRequiredError ? "signed-out" : "signed-out");
        return;
      }
      try {
        const data = await api<{ campaigns: Campaign[] }>("/api/campaigns");
        const active = data.campaigns.filter((c) => c.status !== "archived");
        setCampaigns(active);
        setCampaignId((prev) => prev || active[0]?.id || "");
      } catch (err) {
        if (err instanceof SignInRequiredError) {
          setScreen("signed-out");
          return;
        }
      }
      await refreshStatus();
      setScreen("ready");
    })();
  }, [refreshStatus]);

  // Poll while a run is active so counters and the "cap reached" state stay live.
  useEffect(() => {
    if (status?.running && !pollRef.current) {
      pollRef.current = setInterval(() => void refreshStatus(), 1500);
    } else if (!status?.running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.running, refreshStatus]);

  // Keep Deep from sticking on a site that can't do it.
  useEffect(() => {
    if (status && !status.supportsDeep && mode === "deep") setMode("fast");
  }, [status, mode]);

  async function onCreateCampaign(): Promise<void> {
    const name = newCampaign.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST",
        body: { name },
      });
      setCampaigns((prev) => [res.campaign, ...prev]);
      setCampaignId(res.campaign.id);
      setNewCampaign("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create campaign");
    } finally {
      setCreating(false);
    }
  }

  async function run(
    command: PopupCommand,
    kind: NonNullable<typeof busy>,
  ): Promise<void> {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await sendCommand(command);
      setStatus(result.status);
      if (!result.ok && result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command failed");
    } finally {
      setBusy(null);
    }
  }

  function openDashboard(path = "/leads"): void {
    void chrome.tabs.create({ url: `${API_ORIGIN}${path}` });
  }

  async function onLogout(): Promise<void> {
    await clearToken();
    setStatus(null);
    setCampaigns([]);
    setCampaignId("");
    setError(null);
    setNotice(null);
    setScreen("signed-out");
  }

  /* -- Screens ------------------------------------------------------------ */

  if (screen === "loading") {
    return (
      <Shell>
        <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
      </Shell>
    );
  }

  if (screen === "signed-out") {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-sm">Sign in to the dashboard to continue.</p>
          <button className="btn-primary" onClick={() => openDashboard("/login")}>
            Sign in
          </button>
        </div>
      </Shell>
    );
  }

  const running = status?.running ?? false;
  const tierBlocked = status?.tierBlocked ?? false;
  const supportsDeep = status?.supportsDeep ?? false;
  const captured = status?.captured ?? 0;
  const needsReview = status?.counts.needsReview ?? 0;
  const queued = status?.counts.pending ?? 0;
  const synced = status?.counts.synced ?? 0;
  const reachedCap = status?.reachedCap ?? false;
  const canStart = Boolean(campaignId) && !tierBlocked && !running;

  return (
    <Shell>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Signed in</span>
        <button
          className="text-muted-foreground hover:text-foreground underline"
          disabled={running}
          title={running ? "Stop the capture before logging out" : undefined}
          onClick={() => void onLogout()}
        >
          Log out
        </button>
      </div>

      {tierBlocked && (
        <div className="border-destructive/40 bg-destructive/10 rounded-lg border p-3 text-xs">
          <p className="font-medium">Manual capture only</p>
          <p className="text-muted-foreground mt-1">
            Automated scraping on this site risks an account ban, so ScrapperNinja
            won&apos;t auto-capture here. Use “Capture this page” for one record at
            a time.
          </p>
        </div>
      )}

      {/* Campaign picker (required before Start) */}
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Campaign</span>
        <select
          className="border-input bg-card w-full rounded-md border px-2 py-1.5 text-sm"
          value={campaignId}
          disabled={running}
          onChange={(e) => setCampaignId(e.target.value)}
        >
          <option value="">Select a campaign…</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <input
          className="border-input bg-card w-full rounded-md border px-2 py-1.5 text-sm"
          placeholder="…or create a new campaign"
          value={newCampaign}
          disabled={running}
          onChange={(e) => setNewCampaign(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onCreateCampaign();
          }}
        />
        <button
          className="btn-secondary shrink-0"
          disabled={running || creating || !newCampaign.trim()}
          onClick={() => void onCreateCampaign()}
        >
          {creating ? "…" : "Create"}
        </button>
      </div>

      {/* Fast / Deep */}
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Mode</span>
        <div className="flex gap-2">
          <ToggleButton
            active={mode === "fast"}
            disabled={running}
            onClick={() => setMode("fast")}
          >
            Fast
          </ToggleButton>
          <ToggleButton
            active={mode === "deep"}
            disabled={running || !supportsDeep}
            title={
              supportsDeep ? undefined : "This site doesn't support deep capture"
            }
            onClick={() => setMode("deep")}
          >
            Deep
          </ToggleButton>
        </div>
      </div>

      {/* Pacing */}
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Pacing</span>
        <select
          className="border-input bg-card w-full rounded-md border px-2 py-1.5 text-sm"
          value={pacing}
          disabled={running}
          onChange={(e) => setPacing(e.target.value as Pacing)}
        >
          <option value="slow">Slow (safest)</option>
          <option value="normal">Normal</option>
          <option value="fast">Fast</option>
        </select>
      </label>

      {/* Per-run cap */}
      <label className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Per-run cap</span>
        <input
          type="number"
          min={1}
          className="border-input bg-card w-24 rounded-md border px-2 py-1.5 text-sm"
          value={cap}
          disabled={running}
          onChange={(e) => setCap(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>

      {/* Counters */}
      {status && (captured > 0 || queued > 0 || synced > 0) && (
        <div className="bg-card border-border rounded-lg border p-3 text-xs">
          <p>
            <span className="font-semibold">{captured}</span> captured ·{" "}
            <span className="font-semibold">{needsReview}</span> needs review ·{" "}
            <span className="font-semibold">{queued}</span> queued ·{" "}
            <span className="font-semibold">{synced}</span> synced
          </p>
          {reachedCap && !running && (
            <button
              className="btn-secondary mt-2 w-full"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  { cmd: "KEEP_GOING", additional: CAP_STEP },
                  "start",
                )
              }
            >
              Cap reached — keep going (+{CAP_STEP})
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-muted-foreground text-xs">{notice}</p>
      )}

      {/* Primary actions */}
      <div className="flex flex-col gap-2">
        {running ? (
          <button
            className="btn-primary"
            disabled={busy !== null}
            onClick={() => void run({ cmd: "STOP" }, "stop")}
          >
            {busy === "stop" ? "Stopping…" : "Stop capture"}
          </button>
        ) : (
          <button
            className="btn-primary"
            disabled={busy !== null || !canStart}
            title={campaignId ? undefined : "Pick a campaign first"}
            onClick={() =>
              void run(
                { cmd: "START", campaignId, mode, pacing, cap },
                "start",
              )
            }
          >
            {busy === "start" ? "Starting…" : "Start capture"}
          </button>
        )}

        <button
          className="btn-secondary"
          disabled={busy !== null || !campaignId}
          title={campaignId ? undefined : "Pick a campaign first"}
          onClick={() =>
            void run({ cmd: "MANUAL_CAPTURE", campaignId }, "manual")
          }
        >
          {busy === "manual" ? "Capturing…" : "Capture this page"}
        </button>

        {queued > 0 && (
          <button
            className="text-muted-foreground hover:text-foreground text-xs underline"
            disabled={busy !== null}
            onClick={() => void run({ cmd: "SYNC_NOW" }, "sync")}
          >
            {busy === "sync" ? "Syncing…" : `Sync ${queued} queued now`}
          </button>
        )}

        <button
          className="text-muted-foreground hover:text-foreground text-xs underline"
          onClick={() => openDashboard("/leads")}
        >
          Open Lead Directory
        </button>
      </div>
    </Shell>
  );
}

function ToggleButton({
  active,
  children,
  ...props
}: {
  active: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-50 ${
        active
          ? "bg-primary text-primary-foreground border-transparent"
          : "bg-secondary text-secondary-foreground border-border"
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex items-center justify-between">
        <span className="text-sm font-semibold">ScrapperNinja</span>
      </header>
      {children}
    </div>
  );
}
