/**
 * ScrapperNinja service worker — capture orchestration.
 *
 * Owns all capture state and the offline queue, so closing the popup never
 * interrupts a run. Responsibilities:
 *   - resolve the source adapter for the active tab and ENFORCE tier "d"
 *     (refuse auto capture; manual only) — the hard rule from the plan
 *   - fetch + cache the server selector pack (GET /api/scrape/selectors)
 *   - open a capture session (POST /api/capture-sessions)
 *   - drive the capture loop: harvest visible → (deep) detail → enqueue → pace
 *     → scroll, up to the per-run cap, de-duped by content key
 *   - keep the toolbar badge showing the live captured count
 *   - retry the sync every 5 minutes via chrome.alarms
 *
 * The content script does the DOM work; this worker never touches the page DOM
 * directly (it has no `document`).
 */

import { api } from "../../../shared/api";

import type {
  CaptureMode,
  CaptureStatus,
  CommandResult,
  Pacing,
  PopupCommand,
} from "./lib/commands";
import type { ContentRequest, ContentResponse } from "./lib/messages";
import {
  clearSynced,
  counts,
  enqueue,
  type LeadSourceType,
} from "./lib/queue";
import { syncNow } from "./lib/sync";
import { resolve } from "./scrapers/registry";
import type { HarvestContext, RawRecord, SelectorPack } from "./scrapers/types";

const SYNC_ALARM = "scrapperninja-sync";
const CONTENT_TIMEOUT_MS = 20_000;

/** Randomised inter-action delay by pacing (ms). */
const PACING_RANGES: Record<Pacing, [number, number]> = {
  slow: [2_000, 4_000],
  normal: [800, 2_000],
  fast: [300, 800],
};

/* -- Worker state ---------------------------------------------------------- */

interface WorkerState {
  running: boolean;
  tabId: number | null;
  tabUrl: string | null;
  sourceType: LeadSourceType;
  automationTier: CaptureStatus["automationTier"];
  supportsDeep: boolean;
  tierBlocked: boolean;
  mode: CaptureMode;
  pacing: Pacing;
  cap: number;
  campaignId: string | null;
  sessionId: string | null;
  captured: number;
  needsReview: number;
  reachedCap: boolean;
  reachedEnd: boolean;
  /** Set when the user pressed Stop — distinguishes a normal mid-run stop from
   * a true abort/error when finishing the session. */
  stoppedByUser: boolean;
  lastError: string | null;
}

function defaultState(): WorkerState {
  return {
    running: false,
    tabId: null,
    tabUrl: null,
    sourceType: "generic_web",
    automationTier: "b",
    supportsDeep: false,
    tierBlocked: false,
    mode: "fast",
    pacing: "normal",
    cap: 200,
    campaignId: null,
    sessionId: null,
    captured: 0,
    needsReview: 0,
    reachedCap: false,
    reachedEnd: false,
    stoppedByUser: false,
    lastError: null,
  };
}

let state: WorkerState = defaultState();
/** Bumped on Stop so an in-flight loop knows to exit promptly. */
let runToken = 0;

/* -- Utilities ------------------------------------------------------------- */

function paceDelay(): Promise<void> {
  const [min, max] = PACING_RANGES[state.pacing];
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}

function packKey(sourceId: string): string {
  return `selectorPack:${sourceId}`;
}

async function buildStatus(): Promise<CaptureStatus> {
  return {
    running: state.running,
    tabId: state.tabId,
    tabUrl: state.tabUrl,
    sourceType: state.sourceType,
    automationTier: state.automationTier,
    supportsDeep: state.supportsDeep,
    tierBlocked: state.tierBlocked,
    mode: state.mode,
    pacing: state.pacing,
    cap: state.cap,
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    captured: state.captured,
    reachedCap: state.reachedCap,
    reachedEnd: state.reachedEnd,
    lastError: state.lastError,
    counts: await counts(),
  };
}

async function setBadge(count: number): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: "#8843db" });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/** Send a message to the content script with a timeout. */
function sendToContent(
  tabId: number,
  message: ContentRequest,
): Promise<ContentResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Content script timed out")),
      CONTENT_TIMEOUT_MS,
    );
    chrome.tabs.sendMessage(tabId, message).then(
      (response: ContentResponse) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Make sure the content script is present, injecting it on demand if needed. */
async function ensureContent(tabId: number): Promise<void> {
  try {
    const pong = await sendToContent(tabId, { type: "PING" });
    if (pong.ok) return;
  } catch {
    // Not injected yet — fall through to inject.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

/**
 * Fetch the server selector pack for a source; fall back to the cached copy.
 * The pack `sourceId` is a hyphenated slug (e.g. "google-maps"), while our
 * source types are underscored ("google_maps"), so normalise before matching.
 */
async function loadPack(sourceType: string): Promise<SelectorPack | null> {
  const sourceId = sourceType.replace(/_/g, "-");
  try {
    const res = await api<{ packs: SelectorPack[] }>("/api/scrape/selectors");
    const pack = res.packs.find((p) => p.sourceId === sourceId) ?? null;
    if (pack) await chrome.storage.local.set({ [packKey(sourceId)]: pack });
    return pack;
  } catch {
    const cached = await chrome.storage.local.get(packKey(sourceId));
    return (cached[packKey(sourceId)] as SelectorPack | undefined) ?? null;
  }
}

async function createSession(sourceUrl: string): Promise<string | null> {
  try {
    const res = await api<{ session: { id: string } }>(
      "/api/capture-sessions",
      {
        method: "POST",
        body: {
          campaignId: state.campaignId,
          sourceType: state.sourceType,
          sourceUrl,
          mode: state.mode,
          extensionVersion: chrome.runtime.getManifest().version,
        },
      },
    );
    return res.session.id;
  } catch {
    return null;
  }
}

async function finishSession(
  status: "completed" | "stopped" | "canceled",
): Promise<void> {
  if (!state.sessionId) return;
  try {
    await api(`/api/capture-sessions/${state.sessionId}`, {
      method: "PATCH",
      body: {
        endedAt: new Date().toISOString(),
        capturedCount: state.captured,
        needsReviewCount: state.needsReview,
        status,
      },
    });
  } catch {
    // A missing session route must never crash a finished capture.
  }
}

/**
 * Merge a deep-detail patch onto a card record WITHOUT clobbering good card
 * fields: a detail pass that fails to read (say) the rating must not overwrite
 * the rating we already scraped from the card with null/undefined.
 */
function mergeDetail(base: RawRecord, patch: Partial<RawRecord>): RawRecord {
  const merged: RawRecord = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** Stable-enough dedupe key across scroll steps within one run. */
function dedupeKey(record: RawRecord): string {
  if (record.ref && !record.ref.startsWith("block:")) return record.ref;
  if (record.sourceUrl) return record.sourceUrl;
  if (record.businessName) return `name:${record.businessName}`;
  return `snippet:${(record.rawSnippet ?? "").slice(0, 120)}`;
}

/* -- Capture loop ---------------------------------------------------------- */

async function runCapture(): Promise<void> {
  const token = runToken;
  const tabId = state.tabId;
  if (tabId === null) return;

  const ctx: HarvestContext = {
    mode: state.mode,
    pack: await loadPack(state.sourceType),
    sourceUrl: state.tabUrl ?? "",
  };
  const adapter = resolve(state.tabUrl ?? "");
  const seen = new Set<string>();

  try {
    await ensureContent(tabId);
    while (state.running && token === runToken && !state.reachedCap) {
      const listRes = await sendToContent(tabId, {
        type: "HARVEST_LIST",
        ctx,
      });
      if (!listRes.ok || listRes.type !== "HARVEST_LIST") {
        state.lastError = listRes.ok ? "Unexpected response" : listRes.error;
        break;
      }

      for (const record of listRes.records) {
        if (!state.running || token !== runToken) break;
        const key = dedupeKey(record);
        if (seen.has(key)) continue;
        seen.add(key);

        let merged = record;
        if (
          state.mode === "deep" &&
          adapter.supportsDeep &&
          record.ref &&
          !record.ref.startsWith("block:")
        ) {
          const detailRes = await sendToContent(tabId, {
            type: "HARVEST_DETAIL",
            ctx,
            ref: record,
          });
          if (detailRes.ok && detailRes.type === "HARVEST_DETAIL") {
            merged = mergeDetail(record, detailRes.patch);
          }
          await paceDelay();
        }

        await enqueue({
          payload: merged,
          campaignId: state.campaignId ?? "",
          sessionId: state.sessionId,
          sourceType: state.sourceType,
        });
        state.captured += 1;
        if ((merged.parseIssues?.length ?? 0) > 0) state.needsReview += 1;
        await setBadge(state.captured);

        if (state.captured >= state.cap) {
          state.reachedCap = true;
          break;
        }
        await paceDelay();
      }

      if (state.reachedCap || !state.running || token !== runToken) break;

      const scrollRes = await sendToContent(tabId, { type: "SCROLL", ctx });
      if (scrollRes.ok && scrollRes.type === "SCROLL" && scrollRes.reachedEnd) {
        state.reachedEnd = true;
        break;
      }
      await paceDelay();
    }
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : "Capture failed";
  } finally {
    if (token === runToken) {
      state.running = false;
      await finishSession(
        state.reachedCap || state.reachedEnd
          ? "completed"
          : state.stoppedByUser
            ? "stopped"
            : "canceled",
      );
      void syncNow();
    }
  }
}

/* -- Command handlers ------------------------------------------------------ */

async function handleStart(cmd: {
  campaignId: string;
  mode: CaptureMode;
  pacing: Pacing;
  cap: number;
}): Promise<CommandResult> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    state.lastError = "Open a directory site first.";
    return { ok: false, error: state.lastError, status: await buildStatus() };
  }

  const adapter = resolve(tab.url);
  runToken += 1;
  state = {
    ...defaultState(),
    tabId: tab.id,
    tabUrl: tab.url,
    sourceType: adapter.id as LeadSourceType,
    automationTier: adapter.automationTier,
    supportsDeep: adapter.supportsDeep,
    campaignId: cmd.campaignId,
    mode: adapter.supportsDeep ? cmd.mode : "fast",
    pacing: cmd.pacing,
    cap: cmd.cap,
  };

  // HARD RULE: tier "d" never auto-captures. Refuse and surface the warning.
  if (adapter.automationTier === "d") {
    state.tierBlocked = true;
    state.lastError =
      "This site is manual-only — automated capture is a ban risk.";
    return { ok: false, error: state.lastError, status: await buildStatus() };
  }

  state.running = true;
  await setBadge(0);
  state.sessionId = await createSession(tab.url);
  void runCapture();
  return { ok: true, status: await buildStatus() };
}

async function handleStop(): Promise<CommandResult> {
  runToken += 1;
  state.running = false;
  state.stoppedByUser = true;
  await finishSession("stopped");
  void syncNow();
  return { ok: true, status: await buildStatus() };
}

async function handleKeepGoing(additional: number): Promise<CommandResult> {
  state.cap += additional;
  state.reachedCap = false;
  if (!state.running && state.tabId !== null && !state.tierBlocked) {
    state.running = true;
    runToken += 1;
    void runCapture();
  }
  return { ok: true, status: await buildStatus() };
}

async function handleManualCapture(campaignId: string): Promise<CommandResult> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    return {
      ok: false,
      error: "Open a page to capture first.",
      status: await buildStatus(),
    };
  }
  const adapter = resolve(tab.url);
  state.tabId = tab.id;
  state.tabUrl = tab.url;
  state.sourceType = adapter.id as LeadSourceType;
  state.automationTier = adapter.automationTier;
  state.supportsDeep = adapter.supportsDeep;
  state.tierBlocked = adapter.automationTier === "d";
  state.campaignId = campaignId;

  const ctx: HarvestContext = {
    mode: "fast",
    pack: await loadPack(state.sourceType),
    sourceUrl: tab.url,
  };
  try {
    await ensureContent(tab.id);
    const res = await sendToContent(tab.id, { type: "CAPTURE_PAGE", ctx });
    if (!res.ok || res.type !== "CAPTURE_PAGE") {
      const error = res.ok ? "Unexpected response" : res.error;
      state.lastError = error;
      return { ok: false, error, status: await buildStatus() };
    }
    await enqueue({
      payload: res.record,
      campaignId,
      sessionId: null,
      sourceType: state.sourceType,
    });
    state.captured += 1;
    if ((res.record.parseIssues?.length ?? 0) > 0) state.needsReview += 1;
    await setBadge((await counts()).pending);
    void syncNow();
    return { ok: true, status: await buildStatus() };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Manual capture failed";
    state.lastError = message;
    return { ok: false, error: message, status: await buildStatus() };
  }
}

async function handleSyncNow(): Promise<CommandResult> {
  const { remaining } = await syncNow();
  await setBadge(state.running ? state.captured : remaining);
  return { ok: true, status: await buildStatus() };
}

async function handleCommand(cmd: PopupCommand): Promise<CommandResult> {
  switch (cmd.cmd) {
    case "GET_STATUS": {
      // Refresh which tab/adapter the popup is looking at when idle.
      if (!state.running) {
        const tab = await activeTab();
        if (tab?.url && /^https?:/.test(tab.url)) {
          const adapter = resolve(tab.url);
          state.tabId = tab.id ?? null;
          state.tabUrl = tab.url;
          state.sourceType = adapter.id as LeadSourceType;
          state.automationTier = adapter.automationTier;
          state.supportsDeep = adapter.supportsDeep;
          state.tierBlocked = adapter.automationTier === "d";
        }
      }
      return { ok: true, status: await buildStatus() };
    }
    case "START":
      return handleStart(cmd);
    case "STOP":
      return handleStop();
    case "KEEP_GOING":
      return handleKeepGoing(cmd.additional);
    case "MANUAL_CAPTURE":
      return handleManualCapture(cmd.campaignId);
    case "SYNC_NOW":
      return handleSyncNow();
    default:
      return {
        ok: false,
        error: "Unknown command",
        status: await buildStatus(),
      };
  }
}

/* -- Wiring ---------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle popup commands here (they carry `cmd`); content responses are
  // request/response and never broadcast to the worker.
  if (!message || typeof (message as { cmd?: unknown }).cmd !== "string") {
    return false;
  }
  // Ignore anything not originating from our own extension pages.
  if (sender.id !== chrome.runtime.id) return false;
  void handleCommand(message as PopupCommand).then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  void (async () => {
    const { remaining } = await syncNow();
    // Reflect a shrinking backlog on the badge while idle.
    if (!state.running) await setBadge(remaining);
    // Tidy synced tombstones once nothing is left to send.
    if (remaining === 0) await clearSynced();
  })();
});
