"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format/datetime";
import { LEAD_STATUSES, type Lead, type LeadSource } from "@/lib/db/schema";

export interface LeadDetailDrawerProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the updated lead after a successful save. */
  onUpdated: (lead: Lead) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="text-sm break-words">{children}</span>
    </div>
  );
}

/**
 * Read-only detail view of a lead (identity, contact, provenance, parse issues)
 * inside the shared right-side DetailDrawer, with inline editing of the two
 * fields most often triaged here — status and notes — persisted via
 * `PATCH /api/leads/:id`.
 */
export function LeadDetailDrawer({
  lead,
  open,
  onOpenChange,
  onUpdated,
}: LeadDetailDrawerProps) {
  const [status, setStatus] = useState<Lead["status"]>("new");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<LeadSource[] | null>(null);

  useEffect(() => {
    if (lead) {
      setStatus(lead.status);
      setNotes(lead.notes ?? "");
    }
  }, [lead]);

  // Load the provenance rows whenever the drawer opens for a lead.
  useEffect(() => {
    if (!open || !lead) {
      setSources(null);
      return;
    }
    let cancelled = false;
    const leadId = lead.id;
    void (async () => {
      const res = await fetch(`/api/leads/${leadId}/sources`);
      if (cancelled) return;
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          sources?: LeadSource[];
        };
        setSources(data.sources ?? []);
      } else {
        setSources([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, lead]);

  const dirty =
    lead !== null && (status !== lead.status || notes !== (lead.notes ?? ""));

  async function handleSave() {
    if (!lead) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        lead?: Lead;
        error?: string;
      };
      if (!res.ok || !data.lead) {
        toast.error(data.error ?? "Could not save the lead");
        return;
      }
      onUpdated(data.lead);
      toast.success("Lead updated");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const emails = lead?.emails ?? [];
  const city = lead?.address?.city ?? null;
  const state = lead?.address?.state ?? null;
  const location = [city, state].filter(Boolean).join(", ");

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={lead?.businessName ?? "Lead"}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Close
          </Button>
          <Button onClick={() => void handleSave()} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      {lead === null ? (
        <p className="text-muted-foreground text-sm">No lead selected.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <section className="grid grid-cols-2 gap-4">
            <Field label="Category">{lead.category || "—"}</Field>
            <Field label="Owner">{lead.ownerName || "—"}</Field>
            <Field label="Phone">{lead.phone || "—"}</Field>
            <Field label="Location">{location || "—"}</Field>
            <Field label="Website">
              {lead.website ? (
                <a
                  href={lead.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {lead.website}
                </a>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Emails">
              {emails.length > 0 ? emails.join(", ") : "—"}
            </Field>
            <Field label="Rating">
              {lead.rating != null ? String(lead.rating) : "—"}
            </Field>
            <Field label="Reviews">
              {lead.reviewCount != null ? String(lead.reviewCount) : "—"}
            </Field>
            <Field label="Score">
              {lead.score != null ? (
                <span title={lead.scoreReasoning ?? undefined}>
                  {lead.score}
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Website status">{lead.websiteStatus}</Field>
          </section>

          {lead.offerLine && (
            <section>
              <Field label="Offer line">{lead.offerLine}</Field>
            </section>
          )}

          <section className="border-t pt-4">
            <p className="mb-2 text-xs font-semibold tracking-wide uppercase">
              Provenance
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Source">{lead.sourceType}</Field>
              <Field label="Captured">{formatDateTime(lead.capturedAt)}</Field>
              <Field label="Source URL">
                {lead.sourceUrl ? (
                  <a
                    href={lead.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {lead.sourceUrl}
                  </a>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Created">{formatDateTime(lead.createdAt)}</Field>
            </div>

            {sources !== null && sources.length > 0 && (
              <div className="mt-4">
                <p className="text-muted-foreground mb-2 text-xs font-medium">
                  All captures ({sources.length})
                </p>
                <ul className="flex flex-col gap-2">
                  {sources.map((source) => (
                    <li
                      key={source.id}
                      className="border-border rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{source.sourceType}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(source.capturedAt)}
                        </span>
                      </div>
                      {source.sourceUrl ? (
                        <a
                          href={source.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary text-xs break-all hover:underline"
                        >
                          {source.sourceUrl}
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          No source URL
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {lead.parseIssues.length > 0 && (
            <section className="border-t pt-4">
              <p className="text-destructive mb-2 text-xs font-semibold tracking-wide uppercase">
                Parse issues
              </p>
              <ul className="list-inside list-disc text-sm">
                {lead.parseIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-col gap-3 border-t pt-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-status">Status</Label>
              <Select
                id="lead-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as Lead["status"])}
              >
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-notes">Notes</Label>
              <Textarea
                id="lead-notes"
                value={notes}
                placeholder="Add a note…"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </section>
        </div>
      )}
    </DetailDrawer>
  );
}
