"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableLoadingSkeleton } from "@/components/shared/TableLoadingSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Campaign } from "@/lib/db/schema";
import {
  cachedJsonFetch,
  invalidateFetchCache,
  peekFetchCache,
} from "@/lib/client/fetch-cache";

/**
 * Campaigns list with inline create, edit name/description, archive/reactivate,
 * and delete. Feature components stay feature-scoped (§9).
 */
export function CampaignsManager() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  async function load() {
    const cached = peekFetchCache<{ campaigns: Campaign[] }>("/api/campaigns");
    if (cached) {
      setCampaigns(cached.campaigns);
      return;
    }
    const result = await cachedJsonFetch<{ campaigns: Campaign[] }>(
      "/api/campaigns",
    );
    if (result.ok) {
      setCampaigns(result.data.campaigns);
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
      invalidateFetchCache("/api/campaigns");
    } finally {
      setBusy(false);
    }
  }

  function openEdit(campaign: Campaign) {
    setEditCampaign(campaign);
    setEditName(campaign.name);
    setEditDescription(campaign.description ?? "");
  }

  async function saveEdit() {
    if (!editCampaign) return;
    const trimmedName = editName.trim();
    if (!trimmedName) return;
    setEditBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${editCampaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: editDescription.trim() || null,
        }),
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
        (prev) =>
          prev?.map((c) => (c.id === editCampaign.id ? data.campaign! : c)) ??
          null,
      );
      toast.success("Campaign updated");
      invalidateFetchCache("/api/campaigns");
      setEditCampaign(null);
    } finally {
      setEditBusy(false);
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
    invalidateFetchCache("/api/campaigns");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "Could not delete the campaign");
      return;
    }
    setCampaigns((prev) => prev?.filter((c) => c.id !== id) ?? null);
    invalidateFetchCache("/api/campaigns");
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
        <TableLoadingSkeleton rows={4} />
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
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Edit ${campaign.name}`}
                  onClick={() => openEdit(campaign)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
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

      <Dialog
        open={editCampaign !== null}
        onOpenChange={(next) => {
          if (editBusy) return;
          if (!next) setEditCampaign(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit campaign</DialogTitle>
            <DialogDescription>
              Update the campaign name and an optional description.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-campaign-name">Name</Label>
              <Input
                id="edit-campaign-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-campaign-description">Description</Label>
              <Textarea
                id="edit-campaign-description"
                value={editDescription}
                placeholder="Optional notes about this campaign…"
                rows={3}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditCampaign(null)}
              disabled={editBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveEdit()}
              disabled={editBusy || editName.trim().length === 0}
            >
              {editBusy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
