"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  dismissDuplicate,
  listDuplicates,
  mergeDuplicate,
  type DuplicateCandidate,
} from "@/components/leads/duplicates";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Lead } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/** The lead fields offered as per-field merge choices, in display order. */
const COMPARE_FIELDS: { key: string; label: string; get: (l: Lead) => string }[] =
  [
    { key: "businessName", label: "Business name", get: (l) => l.businessName },
    { key: "phone", label: "Phone", get: (l) => l.phone ?? "" },
    { key: "website", label: "Website", get: (l) => l.website ?? "" },
    { key: "ownerName", label: "Owner", get: (l) => l.ownerName ?? "" },
    { key: "category", label: "Category", get: (l) => l.category ?? "" },
    { key: "city", label: "City", get: (l) => l.address?.city ?? "" },
    { key: "state", label: "State", get: (l) => l.address?.state ?? "" },
    { key: "emails", label: "Emails", get: (l) => (l.emails ?? []).join(", ") },
    { key: "offerLine", label: "Offer line", get: (l) => l.offerLine ?? "" },
    { key: "notes", label: "Notes", get: (l) => l.notes ?? "" },
  ];

function confidencePercent(confidence: number): number {
  const scaled = confidence <= 1 ? confidence * 100 : confidence;
  return Math.round(Math.min(100, Math.max(0, scaled)));
}

/**
 * Duplicate-candidate review queue: side-by-side comparison of two leads with a
 * per-field radio to pick the surviving value, plus a primary selector. Merge
 * writes the survivor (`POST /api/duplicates/:id/merge`); "Keep both" dismisses
 * the pair. Degrades gracefully when the API isn't available yet (404).
 */
export function DuplicateReview() {
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(
    null,
  );
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [primaryId, setPrimaryId] = useState<string>("");
  const [choices, setChoices] = useState<Record<string, string>>({});

  const current = candidates?.[0] ?? null;

  const load = useCallback(async () => {
    const result = await listDuplicates("pending");
    if (result.ok) {
      setUnavailable(false);
      setCandidates(result.data.candidates ?? []);
    } else {
      setUnavailable(result.status === 404);
      setCandidates([]);
      if (result.status !== 404) toast.error(result.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // When the current candidate changes, default primary to leadA and every
  // field choice to the primary lead.
  useEffect(() => {
    if (!current) return;
    setPrimaryId(current.leadA.id);
    const defaults: Record<string, string> = {};
    for (const f of COMPARE_FIELDS) defaults[f.key] = current.leadA.id;
    setChoices(defaults);
  }, [current]);

  // Switching the primary lead re-defaults all field choices to it.
  function selectPrimary(id: string) {
    setPrimaryId(id);
    setChoices((prev) => {
      const next: Record<string, string> = {};
      for (const key of Object.keys(prev)) next[key] = id;
      return next;
    });
  }

  const rows = useMemo(() => {
    if (!current) return [];
    return COMPARE_FIELDS.map((f) => ({
      ...f,
      a: f.get(current.leadA),
      b: f.get(current.leadB),
    })).filter((r) => r.a !== "" || r.b !== "");
  }, [current]);

  async function handleMerge() {
    if (!current) return;
    setBusy(true);
    try {
      const result = await mergeDuplicate(current.id, {
        primaryId,
        fieldChoices: choices,
      });
      if (result.ok) {
        toast.success("Leads merged");
        setCandidates((prev) => prev?.filter((c) => c.id !== current.id) ?? []);
      } else {
        toast.error(result.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss() {
    if (!current) return;
    setBusy(true);
    try {
      const result = await dismissDuplicate(current.id);
      if (result.ok) {
        toast.success("Kept both — dismissed");
        setCandidates((prev) => prev?.filter((c) => c.id !== current.id) ?? []);
      } else {
        toast.error(result.error);
      }
    } finally {
      setBusy(false);
    }
  }

  if (candidates === null) {
    return <p className="text-muted-foreground text-sm">Loading duplicates…</p>;
  }

  if (!current) {
    return (
      <EmptyState
        title={unavailable ? "Duplicate review isn't available yet" : "No duplicates to review"}
        description={
          unavailable
            ? "The duplicate-detection pass hasn't been enabled on this workspace."
            : "Run a “Find duplicates” AI pass from the Leads table and any candidates will appear here."
        }
      />
    );
  }

  const { leadA, leadB } = current;
  const headers = [leadA, leadB];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        <span className="tabular-nums">1 of {candidates.length}</span>
        <span aria-hidden="true">·</span>
        <span>Matched on</span>
        {current.matchedOn.map((m) => (
          <Badge key={m} variant="secondary">
            {m}
          </Badge>
        ))}
        <Badge variant="outline">
          {confidencePercent(current.confidence)}% confidence
        </Badge>
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-muted-foreground w-40 px-3 py-2 text-left font-medium">
                Field
              </th>
              {headers.map((lead, i) => (
                <th key={lead.id} className="px-3 py-2 text-left">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="primary"
                      checked={primaryId === lead.id}
                      onChange={() => selectPrimary(lead.id)}
                      className="accent-primary"
                    />
                    <span className="font-medium">
                      {lead.businessName || `Lead ${i === 0 ? "A" : "B"}`}
                    </span>
                    {primaryId === lead.id && (
                      <Badge variant="default" className="ml-1">
                        primary
                      </Badge>
                    )}
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const identical = row.a === row.b;
              return (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="text-muted-foreground px-3 py-2 align-top">
                    {row.label}
                  </td>
                  {[
                    { lead: leadA, value: row.a },
                    { lead: leadB, value: row.b },
                  ].map(({ lead, value }) => {
                    const chosen = choices[row.key] === lead.id;
                    return (
                      <td key={lead.id} className="px-3 py-2 align-top">
                        <label
                          className={cn(
                            "flex items-start gap-2 rounded-md px-2 py-1",
                            !identical &&
                              chosen &&
                              "bg-primary/10 ring-primary/40 ring-1",
                          )}
                        >
                          {!identical && (
                            <input
                              type="radio"
                              name={`field-${row.key}`}
                              checked={chosen}
                              onChange={() =>
                                setChoices((prev) => ({
                                  ...prev,
                                  [row.key]: lead.id,
                                }))
                              }
                              className="accent-primary mt-0.5"
                            />
                          )}
                          <span className="break-words">
                            {value || (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => void handleDismiss()} disabled={busy}>
          Keep both
        </Button>
        <Button onClick={() => void handleMerge()} disabled={busy}>
          {busy ? "Working…" : "Merge"}
        </Button>
      </div>
    </div>
  );
}
