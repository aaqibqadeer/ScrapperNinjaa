/**
 * Drain the offline capture queue to the backend.
 *
 * Records are grouped by (sourceType, campaignId, sessionId) — the shape
 * POST /api/leads/ingest expects, which carries those three at the BATCH level
 * (not per record) — and sent in chunks of 50 with exponential backoff. A
 * chrome.alarms tick (every 5 minutes, registered in the service worker) calls
 * syncNow() so a queue that failed to flush keeps retrying on its own.
 *
 * Idempotency comes from the clientId → clientCaptureId upsert on the server
 * (unique-sparse (organization_id, client_capture_id)), so a retry never
 * duplicates.
 */

import { api, SignInRequiredError } from "../../../../shared/api";

import {
  counts,
  listPending,
  markFailed,
  markSynced,
  markSyncing,
  type LeadSourceType,
  type QueueRecord,
} from "./queue";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;
/** Backoff schedule (ms) indexed by prior attempt count, capped at the end. */
const BACKOFF_MS = [0, 1_000, 5_000, 15_000, 60_000, 300_000];

/** POST /api/leads/ingest response (built by the web app). */
interface IngestResponse {
  ok: true;
  received: number;
  created: number;
  updated: number;
  needsReview: number;
  rescued: number;
}

/** Sent when a page yielded no name; the server's rescue pass replaces it. */
const PLACEHOLDER_NAME = "Untitled capture";

/** First non-empty line of a snippet, for a businessName fallback. */
function firstLine(snippet: string | null | undefined): string | null {
  if (!snippet) return null;
  for (const line of snippet.split("\n")) {
    const clean = line.trim();
    if (clean.length > 0) return clean.slice(0, 300);
  }
  return null;
}

/** Clip a value to the server's max length; empty becomes null. */
function clip(value: string | null | undefined, max: number): string | null {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
}

/** Map one queued record to an ingest RECORD (batch-level fields excluded). */
function toIngestRecord(record: QueueRecord): Record<string, unknown> {
  const p = record.payload;
  // The server requires a non-empty businessName; generic/manual snippets have
  // none, so fall back to the snippet's first line (the rescue pass replaces it).
  // Page metadata is untrusted input — clip it to the ingest schema's limits so
  // one long title can't 400 the whole batch.
  const businessName =
    clip(p.businessName, 300) ?? firstLine(p.rawSnippet) ?? PLACEHOLDER_NAME;
  return {
    clientCaptureId: record.clientId,
    businessName,
    category: clip(p.category, 200),
    categories: p.categories ?? [],
    description: clip(p.description, 5_000),
    ownerName: clip(p.ownerName, 300),
    phone: clip(p.phone, 100),
    website: clip(p.website, 2_000),
    emails: (p.emails ?? []).filter((e) => e.length <= 320).slice(0, 50),
    socials: p.socials ?? {},
    address: p.address ?? {},
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    rating: p.rating ?? null,
    reviewCount: p.reviewCount ?? null,
    priceLevel: p.priceLevel ?? null,
    hours: clip(p.hours, 2_000),
    plusCode: clip(p.plusCode, 100),
    sourceUrl: clip(p.sourceUrl, 2_000),
    parseIssues: p.parseIssues ?? [],
    rawSnippet: clip(p.rawSnippet, 20_000),
  };
}

/** Group key for one ingest batch: same source, campaign and session. */
function groupKey(record: QueueRecord): string {
  return `${record.sourceType}|${record.campaignId}|${record.sessionId ?? ""}`;
}

interface Batch {
  sourceType: LeadSourceType;
  campaignId: string | null;
  sessionId: string | null;
  records: QueueRecord[];
}

/** Split a set of ready records into per-(source,campaign,session) batches. */
function groupBatches(records: QueueRecord[]): Batch[] {
  const groups = new Map<string, Batch>();
  for (const record of records) {
    const key = groupKey(record);
    let batch = groups.get(key);
    if (!batch) {
      batch = {
        sourceType: record.sourceType,
        campaignId: record.campaignId || null,
        sessionId: record.sessionId,
        records: [],
      };
      groups.set(key, batch);
    }
    batch.records.push(record);
  }
  return [...groups.values()];
}

let running = false;

/**
 * Flush every ready record, one (source,campaign,session) batch at a time.
 * Never throws — a sign-in or network error just leaves records queued for the
 * next tick. Returns how many records remain pending.
 */
export async function syncNow(): Promise<{ remaining: number }> {
  if (running) return { remaining: (await counts()).pending };
  running = true;
  try {
    for (;;) {
      const ready = await listPending(BATCH_SIZE);
      const now = Date.now();
      // Respect per-record backoff for previously-failed records.
      const due = ready.filter((r) => {
        if (r.attempts >= MAX_ATTEMPTS) return false;
        if (r.attempts === 0) return true;
        const wait = BACKOFF_MS[Math.min(r.attempts, BACKOFF_MS.length - 1)];
        return now - r.createdAt >= wait;
      });
      if (due.length === 0) break;

      let progressed = false;
      for (const batch of groupBatches(due)) {
        const ids = batch.records.map((r) => r.clientId);
        await markSyncing(ids);
        try {
          await api<IngestResponse>("/api/leads/ingest", {
            method: "POST",
            body: {
              sourceType: batch.sourceType,
              campaignId: batch.campaignId,
              sessionId: batch.sessionId,
              records: batch.records.map(toIngestRecord),
            },
          });
          await markSynced(ids);
          progressed = true;
        } catch (error) {
          const message =
            error instanceof SignInRequiredError
              ? "Signed out"
              : error instanceof Error
                ? error.message
                : "Sync failed";
          await markFailed(ids, message);
        }
      }
      // If nothing in this pass succeeded, stop; the alarm retries after backoff.
      if (!progressed) break;
    }
    return { remaining: (await counts()).pending };
  } finally {
    running = false;
  }
}
