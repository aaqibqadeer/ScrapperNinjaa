"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Campaign } from "@/lib/db/schema";

/**
 * Campaigns list with inline create, archive/reactivate, and delete. Feature
 * components stay feature-scoped (§9); the leads table's CampaignPicker owns the
 * "pick or quick-create" flow, while this owns full lifecycle management.
 */
export function CampaignsManager() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/campaigns");
    if (res.ok) {
      const data = (await res.json()) as { campaigns: Campaign[] };
      setCampaigns(data.campaigns);
    } else {
      setCampaigns([]);
      toast.error("Could not load campaigns");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        campaign?: Campaign;
        error?: string;
      };
      if (!res.ok || !data.campaign) {
        toast.error(data.error ?? "Could not create the campaign");
        return;
      }
      setCampaigns((prev) => [data.campaign!, ...(prev ?? [])]);
      setName("");
      toast.success(`Created "${data.campaign.name}"`);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "active" | "archived") {
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      campaign?: Campaign;
      error?: string;
    };
    if (!res.ok || !data.campaign) {
      toast.error(data.error ?? "Could not update the campaign");
      return;
    }
    setCampaigns(
      (prev) => prev?.map((c) => (c.id === id ? data.campaign! : c)) ?? null,
    );
  }

  async function remove(id: string) {
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "Could not delete the campaign");
      return;
    }
    setCampaigns((prev) => prev?.filter((c) => c.id !== id) ?? null);
    toast.success("Campaign deleted");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          placeholder="New campaign name…"
          className="max-w-xs"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
        />
        <Button onClick={() => void create()} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create campaign"}
        </Button>
      </div>

      {campaigns === null ? (
        <p className="text-muted-foreground text-sm">Loading campaigns…</p>
      ) : campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Create a campaign to group the leads you capture."
        />
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {campaigns.map((campaign, index) => (
            <li
              key={campaign.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <span className="text-muted-foreground tabular-nums w-6 text-right text-sm">
                {index + 1}
              </span>
              <div className="flex min-w-40 flex-col">
                <span className="font-medium">{campaign.name}</span>
                {campaign.description && (
                  <span className="text-muted-foreground text-xs">
                    {campaign.description}
                  </span>
                )}
              </div>
              <Badge
                variant={campaign.status === "active" ? "default" : "secondary"}
              >
                {campaign.status}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {campaign.leadCount} lead{campaign.leadCount === 1 ? "" : "s"}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/leads?campaignId=${campaign.id}`}>
                    View leads
                  </Link>
                </Button>
                {campaign.status === "active" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void setStatus(campaign.id, "archived")}
                  >
                    Archive
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void setStatus(campaign.id, "active")}
                  >
                    Reactivate
                  </Button>
                )}
                <ConfirmDialog
                  title={`Delete "${campaign.name}"?`}
                  description="Leads keep their data; they're just no longer grouped under this campaign."
                  confirmLabel="Delete"
                  destructive
                  onConfirm={() => remove(campaign.id)}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${campaign.name}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
