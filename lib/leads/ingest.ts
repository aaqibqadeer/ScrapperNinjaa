/**
 * lib/leads/ingest.ts — capture ingest + parse-rescue orchestration (Node).
 *
 * The extension drains its offline queue to POST /api/leads/ingest; this layer
 * upserts each record idempotently on `(organization_id, client_capture_id)`,
 * writes a `lead_sources` provenance row per record, bumps the campaign's
 * denormalized `leadCount` for newly-created leads, and marks records that
 * arrived with `parseIssues` as `needs_review` (keeping their `rawSnippet`).
 *
 * Because retries can never double-insert (the unique sparse index), the whole
 * batch is safe to replay. Up to `INLINE_RESCUE_CAP` flagged records are
 * repaired inline via DeepSeek at sync time (locked decision #6); the rest are
 * left for the /leads "Rescue N records" action, which calls `rescueLeads`.
 *
 * Every AI call goes through `enforceAiQuota` + `recordAiCall` (CLAUDE.md §8);
 * hitting the monthly cap stops rescuing but never fails the ingest itself —
 * the leads are already saved.
 */

import { z } from "zod";

import type { Session } from "@/lib/auth/types";
import {
  db,
  leadAddressSchema,
  leadSourceTypeSchema,
  type Lead,
  type NewLead,
  type UpdateLead,
} from "@/lib/db";
import { rescueFromSnippet } from "@/lib/scrape/rescue";
import { recordAiCall } from "@/lib/usage/ai-usage";
import { enforceAiQuota, UsageLimitError } from "@/lib/usage/enforce";

import { assertScraperEnabled, requireOrg, ScraperError } from "./service";

/** Max flagged records rescued inline during a single ingest (decision #6). */
export const INLINE_RESCUE_CAP = 25;
/** Default ceiling for a batch rescue call (the queue button). */
const DEFAULT_BATCH_RESCUE_LIMIT = 25;
const MAX_BATCH_RESCUE_LIMIT = 100;

/* -------------------------------------------------------------------------- */
/* Input schemas                                                              */
/* -------------------------------------------------------------------------- */

/** One captured business in an ingest batch. `clientCaptureId` is the
 * idempotency key. */
export const ingestRecordSchema = z.object({
  clientCaptureId: z.string().min(1).max(200),
  businessName: z.string().min(1).max(300),
  category: z.string().max(200).nullable().optional(),
  categories: z.array(z.string().max(200)).max(20).optional(),
  phone: z.string().max(100).nullable().optional(),
  website: z.string().max(2000).nullable().optional(),
  address: leadAddressSchema.optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  reviewCount: z.number().nullable().optional(),
  priceLevel: z.number().nullable().optional(),
  hours: z.string().max(2000).nullable().optional(),
  plusCode: z.string().max(100).nullable().optional(),
  sourceUrl: z.string().max(2000).nullable().optional(),
  parseIssues: z.array(z.string().max(100)).max(50).optional(),
  rawSnippet: z.string().max(20000).nullable().optional(),
  /** Untouched provider payload, stored on the provenance row. */
  rawPayload: z.record(z.string(), z.unknown()).optional(),
});
export type IngestRecordInput = z.infer<typeof ingestRecordSchema>;

export const ingestBatchSchema = z.object({
  sourceType: leadSourceTypeSchema,
  campaignId: z.string().min(1).nullable().optional(),
  sessionId: z.string().min(1).nullable().optional(),
  extensionVersion: z.string().max(50).nullable().optional(),
  records: z.array(ingestRecordSchema).min(1).max(200),
});
export type IngestBatchInput = z.infer<typeof ingestBatchSchema>;

export const rescueRequestSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    limit: z.number().int().min(1).max(MAX_BATCH_RESCUE_LIMIT).optional(),
  })
  .default({});
export type RescueRequestInput = z.infer<typeof rescueRequestSchema>;

export interface IngestResult {
  received: number;
  created: number;
  updated: number;
  needsReview: number;
  rescued: number;
}

export interface RescueResult {
  attempted: number;
  rescued: number;
  /** True when the monthly AI cap was hit mid-run (some records left flagged). */
  capReached: boolean;
}

/* -------------------------------------------------------------------------- */
/* Ingest                                                                     */
/* -------------------------------------------------------------------------- */

/** Build a `NewLead` from one validated ingest record. */
function toNewLead(
  orgId: string,
  session: Session,
  sourceType: IngestBatchInput["sourceType"],
  campaignIds: string[],
  captureSessionId: string | null,
  record: IngestRecordInput,
): NewLead {
  const flagged = (record.parseIssues?.length ?? 0) > 0;
  return {
    organizationId: orgId,
    campaignIds,
    sourceType,
    sourceUrl: record.sourceUrl ?? null,
    capturedAt: new Date(),
    capturedByUserId: session.user.id,
    clientCaptureId: record.clientCaptureId,
    captureSessionId,
    businessName: record.businessName,
    category: record.category ?? null,
    categories: record.categories ?? [],
    phone: record.phone ?? null,
    website: record.website ?? null,
    address: record.address ?? {},
    lat: record.lat ?? null,
    lng: record.lng ?? null,
    rating: record.rating ?? null,
    reviewCount: record.reviewCount ?? null,
    priceLevel: record.priceLevel ?? null,
    hours: record.hours ?? null,
    plusCode: record.plusCode ?? null,
    emails: [],
    socials: {},
    techStack: [],
    pageSpeed: {},
    businessSize: "unknown",
    websiteStatus: "unknown",
    // Records arriving with parse issues land in the review queue and keep
    // their raw snippet for the rescue pass.
    status: flagged ? "needs_review" : "new",
    notes: "",
    customFields: {},
    parseIssues: record.parseIssues ?? [],
    rawSnippet: record.rawSnippet ?? null,
    dedupeKeys: [],
  };
}

/**
 * Ingest a batch of captured records. Idempotent (upsert on clientCaptureId),
 * writes provenance, bumps the campaign count for new rows, and rescues up to
 * `INLINE_RESCUE_CAP` flagged records inline.
 */
export async function ingestLeads(
  session: Session,
  input: IngestBatchInput,
): Promise<IngestResult> {
  assertScraperEnabled();
  const orgId = requireOrg(session);

  const campaignId = input.campaignId ?? null;
  if (campaignId) {
    const campaign = await db.getCampaignById(orgId, campaignId);
    if (!campaign) throw new ScraperError("Campaign not found", 404);
  }
  const campaignIds = campaignId ? [campaignId] : [];
  const sessionId = input.sessionId ?? null;

  let created = 0;
  let updated = 0;
  const flaggedLeads: Lead[] = [];

  for (const record of input.records) {
    const { lead, created: wasCreated } =
      await db.upsertLeadByClientCaptureId(
        orgId,
        record.clientCaptureId,
        toNewLead(
          orgId,
          session,
          input.sourceType,
          campaignIds,
          sessionId,
          record,
        ),
      );
    if (wasCreated) created += 1;
    else updated += 1;

    // Provenance: one row per captured record (a merged lead can later show it
    // came from multiple sources — that's why this is a separate collection).
    // The session id is also stashed on the raw payload as a backup pointer.
    await db.createLeadSource({
      organizationId: orgId,
      leadId: lead.id,
      sourceType: input.sourceType,
      sourceUrl: record.sourceUrl ?? null,
      campaignId,
      capturedAt: lead.capturedAt,
      rawPayload: sessionId
        ? { ...(record.rawPayload ?? {}), sessionId }
        : (record.rawPayload ?? {}),
    });

    if (lead.status === "needs_review" && lead.rawSnippet) {
      flaggedLeads.push(lead);
    }
  }

  // Keep the campaign's denormalized count honest — only newly-created leads
  // add to it (a re-synced record already counted on first insert).
  if (campaignId && created > 0) {
    await db.incrementCampaignLeadCount(orgId, campaignId, created);
  }

  const rescued = await rescueFlaggedInline(
    session,
    orgId,
    flaggedLeads.slice(0, INLINE_RESCUE_CAP),
  );

  return {
    received: input.records.length,
    created,
    updated,
    needsReview: flaggedLeads.length,
    rescued,
  };
}

/* -------------------------------------------------------------------------- */
/* Rescue                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Repair one flagged lead from its `rawSnippet`. Consumes one AI-quota call and
 * records it. Returns true on a successful patch. Throws `UsageLimitError` when
 * the monthly cap is hit (the caller decides whether to stop the run).
 */
async function rescueOneLead(
  session: Session,
  orgId: string,
  lead: Lead,
): Promise<boolean> {
  if (!lead.rawSnippet) return false;
  await enforceAiQuota(session);
  const { data, result } = await rescueFromSnippet(lead.rawSnippet);

  const patch: UpdateLead = { parseIssues: [], status: "new" };
  if (data.businessName) patch.businessName = data.businessName;
  if (data.phone) patch.phone = data.phone;
  if (data.website) patch.website = data.website;
  if (data.address) {
    patch.address =
      typeof data.address === "string"
        ? { ...lead.address, raw: data.address }
        : { ...lead.address, ...data.address };
  }

  await db.updateLead(orgId, lead.id, patch);
  await recordAiCall({
    userId: session.user.id,
    organizationId: session.organizationId,
    kind: "lead_rescue",
    model: result.model,
  });
  return true;
}

/**
 * Rescue a bounded list of flagged leads inline. Stops (without erroring) as
 * soon as the AI cap is reached — the ingest's leads are already saved, so a
 * quota wall just leaves the remainder in the review queue. Per-record failures
 * are swallowed so one bad snippet can't sink the batch.
 */
async function rescueFlaggedInline(
  session: Session,
  orgId: string,
  leads: Lead[],
): Promise<number> {
  let rescued = 0;
  for (const lead of leads) {
    try {
      if (await rescueOneLead(session, orgId, lead)) rescued += 1;
    } catch (error) {
      if (error instanceof UsageLimitError) break;
      // A single unparseable snippet stays in the queue; keep going.
    }
  }
  return rescued;
}

/**
 * Batch rescue for the /leads "Rescue N records" action: repair the given lead
 * ids, or (when none are given) drain the needs-review queue up to `limit`.
 */
export async function rescueLeads(
  session: Session,
  input: RescueRequestInput,
): Promise<RescueResult> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const limit = input.limit ?? DEFAULT_BATCH_RESCUE_LIMIT;

  const targets = await resolveRescueTargets(orgId, input.ids, limit);

  let rescued = 0;
  let capReached = false;
  for (const lead of targets) {
    try {
      if (await rescueOneLead(session, orgId, lead)) rescued += 1;
    } catch (error) {
      if (error instanceof UsageLimitError) {
        capReached = true;
        break;
      }
      // Skip an individual unparseable snippet.
    }
  }

  return { attempted: targets.length, rescued, capReached };
}

/** The flagged leads a rescue call targets: explicit ids, else the queue. */
async function resolveRescueTargets(
  orgId: string,
  ids: string[] | undefined,
  limit: number,
): Promise<Lead[]> {
  if (ids && ids.length > 0) {
    const leads: Lead[] = [];
    for (const id of ids.slice(0, limit)) {
      const lead = await db.getLeadById(orgId, id);
      if (lead && lead.rawSnippet) leads.push(lead);
    }
    return leads;
  }
  const { leads } = await db.listLeads(orgId, {
    filter: { status: "needs_review", raw_snippet: { $ne: null } },
    sort: { createdAt: 1 },
    limit,
  });
  return leads;
}
