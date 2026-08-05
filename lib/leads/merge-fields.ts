/**
 * lib/leads/merge-fields.ts — the PURE field-choice resolver behind duplicate
 * merge (Phase 3). Split out from `merge.ts` (which pulls in the DB adapter for
 * its write side) so this stays import-safe and unit-testable with no env/DB.
 *
 * Given a candidate pair's two leads and a per-field `'a' | 'b'` choice, it
 * returns the patch of chosen values for the surviving (primary) lead.
 * `campaignIds` is ALWAYS the union of both (never a choice) — a merged lead
 * belongs to every campaign it appeared in. Type-only imports keep it pure.
 */

import { z } from "zod";

import type { Lead, UpdateLead } from "@/lib/db/schema";

/**
 * Fields the user may resolve per-side in the merge UI. Each exists on both
 * `Lead` and `UpdateLead`. `campaignIds` is intentionally NOT here — it is
 * always unioned.
 */
export const MERGEABLE_FIELDS = [
  "businessName",
  "category",
  "description",
  "phone",
  "phoneE164",
  "website",
  "websiteDomain",
  "ownerName",
  "address",
  "emails",
  "socials",
  "techStack",
  "rating",
  "reviewCount",
  "priceLevel",
  "hours",
  "plusCode",
  "notes",
  "offerLine",
  "score",
  "scoreReasoning",
  "businessSize",
  "industrySubType",
  "websiteStatus",
] as const;
export type MergeableField = (typeof MERGEABLE_FIELDS)[number];

export const fieldChoiceSchema = z.record(z.string(), z.enum(["a", "b"]));
export type FieldChoices = z.infer<typeof fieldChoiceSchema>;

/** Union two id lists, preserving `a`'s order then appending new ids from `b`. */
function unionIds(a: string[], b: string[]): string[] {
  const seen = new Set(a);
  const out = [...a];
  for (const id of b) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Resolve the merged field values from a candidate pair. For each mergeable
 * field the value comes from `leadB` when `fieldChoices[field] === "b"`, else
 * from `leadA` (the default). `campaignIds` is always the union of both.
 * Returns a patch to apply to whichever lead survives.
 */
export function resolveMergedFields(
  leadA: Lead,
  leadB: Lead,
  fieldChoices: FieldChoices,
): UpdateLead {
  const patch: Record<string, unknown> = {};
  for (const field of MERGEABLE_FIELDS) {
    const source = fieldChoices[field] === "b" ? leadB : leadA;
    patch[field] = source[field];
  }
  patch.campaignIds = unionIds(leadA.campaignIds, leadB.campaignIds);
  return patch as UpdateLead;
}
