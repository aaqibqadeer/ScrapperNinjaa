/**
 * lib/leads/query.ts — PURE lead-query builder (no mongoose, no db).
 *
 * Turns validated, whitelisted query params into the plain Mongo-style
 * `{ filter, sort, skip, limit }` the database adapter's `listLeads` /
 * `streamLeads` accept. The adapter forces `organization_id` and excludes
 * soft-deleted rows, so this layer never puts `organizationId` on the filter.
 *
 * Safety rules enforced here:
 *   - every text filter's value is regex-metachar-escaped before it becomes a
 *     `$regex`, so a user can't inject a catastrophic pattern;
 *   - only whitelisted, filterable/sortable columns are accepted — unknown keys
 *     throw, and `customFields.<key>` is allowed only when `<key>` is a real
 *     custom field for the org;
 *   - single-column sort only.
 */

import { z } from "zod";

import {
  leadSourceTypeSchema,
  leadStatusSchema,
  savedViewPageSizeSchema,
} from "@/lib/db/schema";

import {
  customFieldDbPath,
  customFieldSlug,
  getColumn,
  isCustomFieldColumnKey,
  type LeadColumnDef,
} from "./columns";

/** Escape every regex metacharacter so a filter value is matched literally. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A single column's filter directives (any subset may be present). */
export const leadFilterSpecSchema = z
  .object({
    /** Case-insensitive "contains" match. */
    text: z.string().min(1).optional(),
    /** Inclusive lower bound (numeric or date columns). */
    min: z.string().min(1).optional(),
    /** Inclusive upper bound (numeric or date columns). */
    max: z.string().min(1).optional(),
    /** Enum / set membership. */
    in: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();
export type LeadFilterSpec = z.infer<typeof leadFilterSpecSchema>;

/**
 * The validated shape a route hands to `buildLeadQuery`. Column keys inside
 * `filters` are validated against the catalog by `buildLeadQuery`, not here —
 * this schema only guarantees types/ranges.
 */
export const leadQueryParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: savedViewPageSizeSchema.default(25),
  /** Column key to sort by; defaults to `createdAt` when omitted. */
  sort: z.string().optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
  /** Global search across businessName / phone / website / notes. */
  q: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  /** Restrict to leads captured in one capture session (the sessions-table
   * drill-down). Filters `capture_session_id`. */
  sessionId: z.string().min(1).optional(),
  status: leadStatusSchema.optional(),
  sourceType: leadSourceTypeSchema.optional(),
  includeJunk: z.boolean().default(false),
  /**
   * Preset: leads that haven't been enriched (enrichment_status not "done" —
   * includes never-attempted/null). Powers the "not enriched" chip.
   */
  notEnriched: z.boolean().default(false),
  /**
   * Preset: leads with no offer line yet (null or empty). Powers the "no offer
   * line" chip. Kept as a dedicated param because the query layer has no
   * generic "empty text" filter operator.
   */
  missingOfferLine: z.boolean().default(false),
  /** Per-column filters, keyed by column key (`f.<col>...` in the URL). */
  filters: z.record(z.string(), leadFilterSpecSchema).default({}),
});
export type LeadQueryParams = z.infer<typeof leadQueryParamsSchema>;

export interface BuiltLeadQuery {
  filter: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
  skip: number;
  limit: number;
}

/** Global-search columns (public key → stored Mongo field). */
const GLOBAL_SEARCH_FIELDS = ["business_name", "phone", "website", "notes"];
const STATUS_DB_FIELD = "status";

class LeadQueryError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "LeadQueryError";
  }
}

/** Resolve a filterable column key to its stored Mongo path (or throw). */
function resolveFilterField(key: string, customFieldKeys: string[]): string {
  if (isCustomFieldColumnKey(key)) {
    const slug = customFieldSlug(key);
    const path = customFieldDbPath(key);
    if (!path || !slug || !customFieldKeys.includes(slug)) {
      throw new LeadQueryError(`Unknown filter column: "${key}"`);
    }
    return path;
  }
  const column = getColumn(key);
  if (!column) throw new LeadQueryError(`Unknown filter column: "${key}"`);
  if (!column.filterable) {
    throw new LeadQueryError(`Column "${key}" is not filterable`);
  }
  return column.filterField ?? column.key;
}

/** Resolve a sortable column key to its stored Mongo path (or throw). */
function resolveSortField(key: string, customFieldKeys: string[]): string {
  if (isCustomFieldColumnKey(key)) {
    const slug = customFieldSlug(key);
    const path = customFieldDbPath(key);
    if (!path || !slug || !customFieldKeys.includes(slug)) {
      throw new LeadQueryError(`Unknown sort column: "${key}"`);
    }
    return path;
  }
  const column = getColumn(key);
  if (!column) throw new LeadQueryError(`Unknown sort column: "${key}"`);
  if (!column.sortable) {
    throw new LeadQueryError(`Column "${key}" is not sortable`);
  }
  return column.sortField ?? column.key;
}

/** Coerce a range bound to the column's type (number / date / raw string). */
function coerceBound(column: LeadColumnDef | undefined, raw: string): unknown {
  const type = column?.type;
  if (type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new LeadQueryError(`Invalid numeric bound: "${raw}"`);
    }
    return n;
  }
  if (type === "date") {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw new LeadQueryError(`Invalid date bound: "${raw}"`);
    }
    return d;
  }
  // Text/enum/custom columns: prefer a number when it parses cleanly, else a
  // date, else the raw string — so a numeric custom field still ranges.
  if (column === undefined) {
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) return n;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return raw;
}

/** Build one column's Mongo condition from its filter spec. */
function buildColumnCondition(
  column: LeadColumnDef | undefined,
  spec: LeadFilterSpec,
): unknown {
  if (spec.in !== undefined) {
    return { $in: spec.in };
  }
  if (spec.min !== undefined || spec.max !== undefined) {
    const range: Record<string, unknown> = {};
    if (spec.min !== undefined) range.$gte = coerceBound(column, spec.min);
    if (spec.max !== undefined) range.$lte = coerceBound(column, spec.max);
    return range;
  }
  if (spec.text !== undefined) {
    return { $regex: escapeRegex(spec.text), $options: "i" };
  }
  // An empty spec is a no-op the caller filters out; guard defensively.
  throw new LeadQueryError("Empty filter spec");
}

/**
 * Build the `{ filter, sort, skip, limit }` for a paged lead read. `orgId` is
 * intentionally NOT written to `filter` — the adapter forces it (and excludes
 * soft-deleted rows). It is accepted for symmetry / future use.
 */
export function buildLeadQuery(
  orgId: string,
  params: LeadQueryParams,
  customFieldKeys: string[],
): BuiltLeadQuery {
  void orgId;
  const filter: Record<string, unknown> = {};

  // Global search — regex OR across a fixed set of text columns.
  if (params.q) {
    const pattern = escapeRegex(params.q);
    filter.$or = GLOBAL_SEARCH_FIELDS.map((field) => ({
      [field]: { $regex: pattern, $options: "i" },
    }));
  }

  // Top-level scalar filters.
  if (params.campaignId) filter.campaign_ids = params.campaignId;
  if (params.sessionId) filter.capture_session_id = params.sessionId;
  if (params.sourceType) filter.source_type = params.sourceType;
  if (params.status) filter[STATUS_DB_FIELD] = params.status;

  // Preset filters (chips). "Not enriched" matches anything not marked done,
  // including a null/absent status; "missing offer line" matches null/empty.
  if (params.notEnriched) filter.enrichment_status = { $ne: "done" };
  if (params.missingOfferLine) {
    filter.$and = [
      ...((filter.$and as unknown[]) ?? []),
      { $or: [{ offer_line: null }, { offer_line: "" }] },
    ];
  }

  // Per-column filters (validated + whitelisted).
  let statusExplicitlyFiltered = params.status !== undefined;
  for (const [key, spec] of Object.entries(params.filters)) {
    if (
      spec.text === undefined &&
      spec.min === undefined &&
      spec.max === undefined &&
      spec.in === undefined
    ) {
      continue; // no-op spec
    }
    const field = resolveFilterField(key, customFieldKeys);
    const column = isCustomFieldColumnKey(key) ? undefined : getColumn(key);
    filter[field] = buildColumnCondition(column, spec);
    if (field === STATUS_DB_FIELD) statusExplicitlyFiltered = true;
  }

  // Junk is hidden unless explicitly asked for (includeJunk) or the caller has
  // constrained `status` themselves (e.g. status=junk, or f.status.in=…).
  if (!params.includeJunk && !statusExplicitlyFiltered) {
    filter[STATUS_DB_FIELD] = { $ne: "junk" };
  }

  // Single-column sort; default createdAt desc.
  const sortField = params.sort
    ? resolveSortField(params.sort, customFieldKeys)
    : "createdAt";
  const sort: Record<string, 1 | -1> = {
    [sortField]: params.dir === "asc" ? 1 : -1,
  };

  const skip = (params.page - 1) * params.pageSize;
  return { filter, sort, skip, limit: params.pageSize };
}

/**
 * Extract a raw params object from a URL query string, then validate it with
 * `leadQueryParamsSchema`. Recognizes:
 *   - page, pageSize, sort, dir, q, campaignId, sessionId, status, sourceType,
 *     includeJunk
 *   - f.<col>=text                     → contains
 *   - f.<col>.min / f.<col>.max=…      → range bounds
 *   - f.<col>.in=a,b,c                 → set membership
 *
 * Column keys are NOT validated here (that happens in `buildLeadQuery`, which
 * knows the org's custom fields) — this only shapes and type-checks values.
 */
export function parseLeadQueryFromSearchParams(
  searchParams: URLSearchParams,
  customFieldKeys: string[],
): LeadQueryParams {
  const filters: Record<string, LeadFilterSpec> = {};

  const ensure = (col: string): Record<string, unknown> => {
    const existing = filters[col] as Record<string, unknown> | undefined;
    if (existing) return existing;
    const fresh: Record<string, unknown> = {};
    filters[col] = fresh as LeadFilterSpec;
    return fresh;
  };

  for (const [rawKey, value] of searchParams.entries()) {
    if (!rawKey.startsWith("f.")) continue;
    const body = rawKey.slice(2);
    // A custom-field key is itself `customFields.<slug>`, so split off a known
    // trailing operator (.min/.max/.in) rather than the first dot.
    let col = body;
    let op: "text" | "min" | "max" | "in" = "text";
    for (const candidate of [".min", ".max", ".in"] as const) {
      if (body.endsWith(candidate)) {
        col = body.slice(0, -candidate.length);
        op = candidate.slice(1) as "min" | "max" | "in";
        break;
      }
    }
    if (!col) continue;
    const spec = ensure(col);
    if (op === "in") {
      spec.in = value
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    } else {
      spec[op] = value;
    }
  }

  const raw: Record<string, unknown> = { filters };
  const page = searchParams.get("page");
  if (page !== null) raw.page = page;
  const pageSize = searchParams.get("pageSize");
  if (pageSize !== null) raw.pageSize = Number(pageSize);
  const sort = searchParams.get("sort");
  if (sort !== null) raw.sort = sort;
  const dir = searchParams.get("dir");
  if (dir !== null) raw.dir = dir;
  const q = searchParams.get("q");
  if (q !== null && q.length > 0) raw.q = q;
  const campaignId = searchParams.get("campaignId");
  if (campaignId !== null && campaignId.length > 0) raw.campaignId = campaignId;
  const sessionId = searchParams.get("sessionId");
  if (sessionId !== null && sessionId.length > 0) raw.sessionId = sessionId;
  const status = searchParams.get("status");
  if (status !== null && status.length > 0) raw.status = status;
  const sourceType = searchParams.get("sourceType");
  if (sourceType !== null && sourceType.length > 0) {
    raw.sourceType = sourceType;
  }
  const includeJunk = searchParams.get("includeJunk");
  if (includeJunk !== null) {
    raw.includeJunk = includeJunk === "1" || includeJunk === "true";
  }
  const notEnriched = searchParams.get("notEnriched");
  if (notEnriched !== null) {
    raw.notEnriched = notEnriched === "1" || notEnriched === "true";
  }
  const missingOfferLine = searchParams.get("missingOfferLine");
  if (missingOfferLine !== null) {
    raw.missingOfferLine =
      missingOfferLine === "1" || missingOfferLine === "true";
  }

  // Drop any spec that ended up empty (e.g. blank value).
  for (const [col, spec] of Object.entries(filters)) {
    const s = spec as LeadFilterSpec;
    const empty =
      (s.text === undefined || s.text === "") &&
      (s.min === undefined || s.min === "") &&
      (s.max === undefined || s.max === "") &&
      (s.in === undefined || s.in.length === 0);
    if (empty) delete filters[col];
  }

  void customFieldKeys;
  return leadQueryParamsSchema.parse(raw);
}
