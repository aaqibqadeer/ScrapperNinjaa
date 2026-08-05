"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { RowNumberCell } from "@/components/shared/RowNumberCell";
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
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AUTOMATION_TIERS, type SourcePack } from "@/lib/db/schema";

export interface SourcePacksManagerProps {
  packs: SourcePack[];
}

interface EditState {
  /** null → creating a new pack; otherwise editing this pack. */
  pack: SourcePack | null;
  sourceId: string;
  automationTier: string;
  version: string;
  notes: string;
  isActive: boolean;
  selectorsJson: string;
}

function emptyEdit(): EditState {
  return {
    pack: null,
    sourceId: "",
    automationTier: "a",
    version: "1",
    notes: "",
    isActive: true,
    selectorsJson: "{\n  \n}",
  };
}

function editFrom(pack: SourcePack): EditState {
  return {
    pack,
    sourceId: pack.sourceId,
    automationTier: pack.automationTier,
    version: String(pack.version),
    notes: pack.notes ?? "",
    isActive: pack.isActive,
    selectorsJson: JSON.stringify(pack.selectors, null, 2),
  };
}

/**
 * Super-admin CRUD for server-pushed selector packs (decision #7). Selectors
 * live in the platform-level `source_packs` collection so a DOM change is fixed
 * by editing a pack here, not shipping a new extension build.
 */
export function SourcePacksManager({ packs }: SourcePacksManagerProps) {
  const [edit, setEdit] = useState<EditState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function openCreate() {
    setEdit(emptyEdit());
    setOpen(true);
  }

  function openEdit(pack: SourcePack) {
    setEdit(editFrom(pack));
    setOpen(true);
  }

  async function toggleActive(pack: SourcePack) {
    setBusyId(pack.id);
    try {
      const res = await fetch("/api/admin/source-packs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pack.id, isActive: !pack.isActive }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not update the pack");
        return;
      }
      toast.success(pack.isActive ? "Pack deactivated" : "Pack activated");
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  async function deletePack(pack: SourcePack) {
    const res = await fetch("/api/admin/source-packs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pack.id }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Could not delete the pack");
    toast.success("Pack deleted");
    window.location.reload();
  }

  async function save() {
    if (!edit) return;

    let selectors: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(edit.selectorsJson);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        !Object.values(parsed).every((v) => typeof v === "string")
      ) {
        throw new Error("Selectors must be a flat object of string values");
      }
      selectors = parsed as Record<string, string>;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Selectors is not valid JSON",
      );
      return;
    }

    const version = Number(edit.version);
    if (!Number.isInteger(version) || version < 0) {
      toast.error("Version must be a non-negative integer");
      return;
    }

    setBusy(true);
    try {
      const creating = edit.pack === null;
      const body = creating
        ? {
            sourceId: edit.sourceId.trim(),
            automationTier: edit.automationTier,
            version,
            notes: edit.notes.trim() || null,
            isActive: edit.isActive,
            selectors,
          }
        : {
            id: edit.pack!.id,
            automationTier: edit.automationTier,
            version,
            notes: edit.notes.trim() || null,
            isActive: edit.isActive,
            selectors,
          };
      const res = await fetch("/api/admin/source-packs", {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not save the pack");
        return;
      }
      toast.success(creating ? "Source pack created" : "Source pack saved");
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  const columns: DataTableColumn<SourcePack>[] = [
    {
      key: "num",
      header: "#",
      className: "w-10 text-right",
      cell: (_p, index) => <RowNumberCell index={index} />,
    },
    {
      key: "sourceId",
      header: "Source",
      cell: (p) => (
        <span className="font-medium">
          {p.sourceId}
          {!p.isActive && (
            <Badge variant="outline" className="ml-2">
              inactive
            </Badge>
          )}
        </span>
      ),
    },
    { key: "tier", header: "Tier", cell: (p) => p.automationTier },
    { key: "version", header: "Version", cell: (p) => p.version },
    {
      key: "selectors",
      header: "Selectors",
      cell: (p) => `${Object.keys(p.selectors).length} keys`,
    },
    {
      key: "notes",
      header: "Notes",
      cell: (p) => (
        <span className="text-muted-foreground block max-w-56 truncate">
          {p.notes || "—"}
        </span>
      ),
    },
    {
      key: "active",
      header: "Active",
      cell: (p) => (
        <Switch
          checked={p.isActive}
          disabled={busyId === p.id}
          onCheckedChange={() => toggleActive(p)}
          aria-label={`Toggle ${p.sourceId}`}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
            Edit
          </Button>
          <ConfirmDialog
            destructive
            title="Delete source pack"
            description={`Delete "${p.sourceId}"? The extension will fall back to its bundled selectors.`}
            confirmLabel="Delete"
            onConfirm={() => deletePack(p)}
            trigger={
              <Button variant="ghost" size="sm">
                Delete
              </Button>
            }
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          Selector packs are platform-wide — the same CSS selectors serve every
          tenant&apos;s extension. Bump the version on every edit so extensions
          cache-invalidate.
        </p>
        <Button size="sm" onClick={openCreate}>
          Add source pack
        </Button>
      </div>

      <DataTable
        rows={packs}
        getRowKey={(p) => p.id}
        columns={columns}
        empty={
          <EmptyState
            title="No source packs yet."
            description="Create one to push selectors to the capture extension."
            action={
              <Button size="sm" onClick={openCreate}>
                Add source pack
              </Button>
            }
          />
        }
      />

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {edit?.pack ? `Edit ${edit.pack.sourceId}` : "Add source pack"}
            </DialogTitle>
            <DialogDescription>
              Selectors is a flat JSON object mapping a logical field name to a
              CSS selector.
            </DialogDescription>
          </DialogHeader>

          {edit && (
            <div className="flex flex-col gap-3">
              {edit.pack === null && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pack-source-id">Source id</Label>
                  <Input
                    id="pack-source-id"
                    value={edit.sourceId}
                    placeholder="google-maps"
                    onChange={(e) =>
                      setEdit((s) =>
                        s ? { ...s, sourceId: e.target.value } : s,
                      )
                    }
                  />
                  <span className="text-muted-foreground text-xs">
                    Lowercase letters, digits, hyphens. Cannot be changed later.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pack-tier">Automation tier</Label>
                  <Select
                    id="pack-tier"
                    value={edit.automationTier}
                    onChange={(e) =>
                      setEdit((s) =>
                        s ? { ...s, automationTier: e.target.value } : s,
                      )
                    }
                  >
                    {AUTOMATION_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pack-version">Version</Label>
                  <Input
                    id="pack-version"
                    type="number"
                    min={0}
                    value={edit.version}
                    onChange={(e) =>
                      setEdit((s) => (s ? { ...s, version: e.target.value } : s))
                    }
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pack-selectors">Selectors (JSON)</Label>
                <Textarea
                  id="pack-selectors"
                  className="min-h-40 font-mono text-xs"
                  value={edit.selectorsJson}
                  onChange={(e) =>
                    setEdit((s) =>
                      s ? { ...s, selectorsJson: e.target.value } : s,
                    )
                  }
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pack-notes">Notes</Label>
                <Textarea
                  id="pack-notes"
                  value={edit.notes}
                  placeholder="What changed, why, source DOM quirks…"
                  onChange={(e) =>
                    setEdit((s) => (s ? { ...s, notes: e.target.value } : s))
                  }
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={edit.isActive}
                  onCheckedChange={(checked) =>
                    setEdit((s) => (s ? { ...s, isActive: checked } : s))
                  }
                  aria-label="Active"
                />
                Active (served to extensions)
              </label>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save pack"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
