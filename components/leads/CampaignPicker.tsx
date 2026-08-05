"use client";

import { useState } from "react";
import { toast } from "sonner";

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
import { Select } from "@/components/ui/select";
import type { Campaign } from "@/lib/db/schema";
import { invalidateFetchCache } from "@/lib/client/fetch-cache";
import { cn } from "@/lib/utils";

export interface CampaignOption {
  id: string;
  name: string;
}

export interface CampaignPickerProps {
  /** The selected campaign id, or null for "no campaign". */
  value: string | null;
  onChange: (campaignId: string | null) => void;
  campaigns: CampaignOption[];
  /** Called with the freshly-created campaign after a successful "New" flow. */
  onCreated: (campaign: Campaign) => void;
  /** Placeholder label for the empty selection. */
  placeholder?: string;
  /** When false, hides the inline "New" button (e.g. creation lives in a menu). */
  showCreateButton?: boolean;
  /** Controlled create-dialog open state (for external triggers like a More menu). */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * Pick an existing campaign from a Select, or create one inline via a small
 * dialog. Creation posts to `/api/campaigns`; on success the new campaign is
 * handed back through `onCreated` and immediately selected.
 */
export function CampaignPicker({
  value,
  onChange,
  campaigns,
  onCreated,
  placeholder = "No campaign",
  showCreateButton = true,
  createOpen: createOpenProp,
  onCreateOpenChange,
  className,
}: CampaignPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = createOpenProp ?? internalOpen;
  const setOpen = onCreateOpenChange ?? setInternalOpen;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
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
      onCreated(data.campaign);
      onChange(data.campaign.id);
      invalidateFetchCache("/api/campaigns");
      toast.success(`Created campaign "${data.campaign.name}"`);
      setName("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Select
        className="h-8 w-48"
        aria-label="Campaign"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? e.target.value : null)}
      >
        <option value="">{placeholder}</option>
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </Select>
      {showCreateButton && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          New
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) setName("");
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>
              Group captured leads under a named campaign.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-campaign-name">Name</Label>
            <Input
              id="new-campaign-name"
              value={name}
              placeholder="e.g. Austin dentists"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={busy || name.trim().length === 0}
            >
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
