/**
 * lib/scrape/rescue.ts — the second-layer parse repair (locked decision #6).
 *
 * When the extension flags a captured record with `parseIssues`, its messy
 * `rawSnippet` is sent to DeepSeek to re-extract the core fields as JSON. This
 * fires on the backend at sync time (inline, for a bounded number of records)
 * and again from the /leads "Rescue N records" action.
 *
 * `parseRescueResponse` is a PURE function (Zod validation of the model's text)
 * so it is unit-tested without any provider call; `rescueFromSnippet` wraps it
 * with the routed generation. Route/service callers own quota enforcement and
 * `recordAiCall` (CLAUDE.md §8 — never call a provider from a route directly).
 */

import { z } from "zod";

import type { GenerateResult } from "@/lib/ai";
import { leadAddressSchema } from "@/lib/db/schema";

import { extractJson, generateJsonForTask, clip } from "./generate";

/**
 * The shape DeepSeek returns for one rescued record. Everything is nullable —
 * a snippet the model genuinely can't read a phone out of should return null,
 * not a hallucinated value. `address` accepts either a single raw string or the
 * structured address object.
 *
 * The field list mirrors what a capture can be missing. It covers more than
 * name/phone/website/address because the pages that need rescuing most (social
 * profiles, tier-d captures) publish their category and bio as plain text and
 * nothing else — extracting only four fields left those rows effectively empty.
 */
export const rescuedRecordSchema = z.object({
  businessName: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  ownerName: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  website: z.string().nullable().default(null),
  emails: z.array(z.string()).default([]),
  address: z
    .union([z.string(), leadAddressSchema])
    .nullable()
    .default(null),
});
export type RescuedRecord = z.infer<typeof rescuedRecordSchema>;

/**
 * Validate a model response into a `RescuedRecord`. Pure — extracts the JSON
 * payload (fenced or bare) then Zod-parses it. Throws on non-JSON / invalid
 * shape so a bad rescue never silently patches a lead with garbage.
 */
export function parseRescueResponse(text: string): RescuedRecord {
  return rescuedRecordSchema.parse(extractJson(text));
}

const RESCUE_SYSTEM =
  "You repair a single messy business listing captured from a directory page. " +
  "Respond with ONLY a JSON object — no prose, no markdown fences.";

function rescuePrompt(snippet: string): string {
  return `Extract the business's core fields from this raw captured text.
Return exactly this JSON object:
{
  "businessName": string|null,
  "category": string|null,
  "description": string|null,
  "ownerName": string|null,
  "phone": string|null,
  "website": string|null,
  "emails": string[],
  "address": string|null
}
- category: what the business DOES ("plumber", "dental clinic"), never a rating,
  a review count or a follower count.
- description: the business's own blurb / bio, trimmed to one paragraph.
- emails: every address in the text, or [].
Use null for anything not present. Do NOT invent values — a field you cannot
read from the text MUST be null.

Raw captured text:
"""
${clip(snippet, 4_000)}
"""`;
}

/**
 * Rescue one flagged record's `rawSnippet` via the routed provider (DeepSeek).
 * Returns the parsed record plus the raw `GenerateResult` so the caller can
 * record the billable AI call.
 */
export async function rescueFromSnippet(
  snippet: string,
): Promise<{ data: RescuedRecord; result: GenerateResult }> {
  return generateJsonForTask(
    "rescue",
    rescuedRecordSchema,
    RESCUE_SYSTEM,
    rescuePrompt(snippet),
  );
}
