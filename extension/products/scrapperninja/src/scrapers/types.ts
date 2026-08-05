/**
 * Source-adapter contract for ScrapperNinja capture.
 *
 * Adapters resolve per URL and know HOW to read one directory site. The
 * harvest methods touch the DOM and therefore only ever RUN inside the content
 * script — but this module is pure types + interfaces so both the service
 * worker (for tier enforcement and registry resolution) and the content script
 * can import it. Keep all `document`/`window` access inside method bodies so
 * importing an adapter into the service worker (which has no DOM) is safe.
 *
 * Tiers (mirrors AUTOMATION_TIERS in lib/db/schema.ts):
 *   a — full automation, high value (Google Maps)
 *   b — automated but AI-extracted (generic directories)
 *   c — deferred (SoS registries; CSV import covers it in Phase 1)
 *   d — manual only, automation is a ban risk (LinkedIn/IG/FB)
 */

export type AutomationTier = "a" | "b" | "c" | "d";

/** A postal address parsed best-effort from the source. */
export interface RawAddress {
  raw?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/**
 * One captured business, in the extension's wire shape. Every field is
 * best-effort; the server (POST /api/leads/ingest) maps this onto the Lead
 * schema and upserts by `clientCaptureId`.
 */
export interface RawRecord {
  /** Idempotency key, assigned when the record is enqueued (crypto.randomUUID). */
  clientId?: string;
  businessName?: string | null;
  category?: string | null;
  categories?: string[];
  /** Bio / about text — the only real content a social profile publishes. */
  description?: string | null;
  ownerName?: string | null;
  phone?: string | null;
  website?: string | null;
  emails?: string[];
  /** Profile URLs by platform (facebook, instagram, linkedin, x, …). */
  socials?: Record<string, string | null>;
  address?: RawAddress;
  rating?: number | null;
  reviewCount?: number | null;
  priceLevel?: number | null;
  hours?: string | null;
  plusCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** URL of the individual result, when the adapter can determine it. */
  sourceUrl?: string | null;
  /**
   * A stable per-result handle used to (a) de-duplicate across scroll steps and
   * (b) open the result again for a deep detail pass. For Maps this is the card
   * href; for generic it is the block index.
   */
  ref?: string | null;
  /** Cleaned text kept for server-side AI rescue when parsing was incomplete. */
  rawSnippet?: string | null;
  /** e.g. ["needs_ai_extract"] — flags the row for server rescue / review. */
  parseIssues?: string[];
}

/** Server-pushed selector pack for a source (falls back to bundled selectors). */
export interface SelectorPack {
  sourceId: string;
  version: number | string;
  selectors: Record<string, string>;
}

/** What an adapter's harvest methods need. Passed from the service worker. */
export interface HarvestContext {
  mode: "fast" | "deep";
  /** Runtime selectors from the server pack; null → use bundled fallback. */
  pack: SelectorPack | null;
  sourceUrl: string;
}

/**
 * Knows how to read ONE family of directory sites. `match`, `automationTier`
 * and `supportsDeep` are metadata safe to read anywhere; the async methods
 * touch the DOM and run only in the content script.
 */
export interface SourceAdapter {
  id: string;
  automationTier: AutomationTier;
  supportsDeep: boolean;
  match(url: string): boolean;
  /** Harvest the results currently visible in the viewport (no scrolling). */
  harvestList(ctx: HarvestContext): Promise<RawRecord[]>;
  /** Open one result and read its detail panel (deep mode). */
  harvestDetail?(ctx: HarvestContext, ref: RawRecord): Promise<Partial<RawRecord>>;
  /** One-shot capture of the visible page (manual + fallback). */
  capturePage(ctx: HarvestContext): Promise<RawRecord>;
  /** Scroll the results feed by one step; resolves whether the end was reached. */
  scroll?(ctx: HarvestContext): Promise<{ reachedEnd: boolean }>;
}
