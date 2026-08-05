/**
 * lib/leads/columns.ts — the single catalog of lead table columns.
 *
 * Every surface that talks about a column (the query layer's filter/sort
 * whitelist, CSV export, and later the table UI) reads from `LEAD_COLUMNS` here
 * so there is exactly one place that knows a column's stored Mongo path, its
 * type, and whether it may be sorted / filtered / edited / exported.
 *
 * Pure module: no mongoose, no db — safe to import from anywhere.
 *
 * `key` is the stable public identifier used in query strings and saved views.
 * `sortField` / `filterField` are the stored (snake_case) Mongo paths the
 * adapter passes straight to `find()` — several public keys are friendlier
 * aliases (e.g. `city` → `address.city`). Custom fields are addressed
 * dynamically as `customFields.<key>` and map to `custom_fields.<key>`.
 */

import {
  BUSINESS_SIZES,
  ENRICHMENT_STATUSES,
  LEAD_SOURCE_TYPES,
  LEAD_STATUSES,
  WEBSITE_STATUSES,
} from "@/lib/db/schema";

export type ColumnType = "text" | "number" | "date" | "enum" | "boolean";

export interface LeadColumnDef {
  key: string; // e.g. "businessName", "address.city" or "city" as alias
  label: string;
  type: ColumnType;
  sortable: boolean;
  filterable: boolean;
  editable: boolean;
  exportable: boolean;
  defaultVisible: boolean;
  /** For enum columns */
  enumValues?: readonly string[];
  /** Mongo / sort path */
  sortField?: string;
  filterField?: string;
}

/** Prefix marking a dynamic per-org custom-field column key. */
export const CUSTOM_FIELD_PREFIX = "customFields.";
/** Stored Mongo path prefix for custom field values. */
export const CUSTOM_FIELD_DB_PREFIX = "custom_fields.";

/**
 * The catalog. Order here is the natural left-to-right column order the UI
 * falls back to. `sortField`/`filterField` default to `key` when omitted; they
 * are set explicitly whenever the stored path differs from the public key.
 */
export const LEAD_COLUMNS: readonly LeadColumnDef[] = [
  {
    key: "businessName",
    label: "Business Name",
    type: "text",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: true,
    sortField: "business_name",
    filterField: "business_name",
  },
  {
    key: "phone",
    label: "Phone",
    type: "text",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: true,
    sortField: "phone",
    filterField: "phone",
  },
  {
    key: "website",
    label: "Website",
    type: "text",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: true,
    sortField: "website",
    filterField: "website",
  },
  {
    key: "category",
    label: "Category",
    type: "text",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: true,
    sortField: "category",
    filterField: "category",
  },
  {
    key: "city",
    label: "City",
    type: "text",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: true,
    sortField: "address.city",
    filterField: "address.city",
  },
  {
    key: "state",
    label: "State",
    type: "text",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    sortField: "address.state",
    filterField: "address.state",
  },
  {
    key: "ownerName",
    label: "Owner Name",
    type: "text",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: true,
    sortField: "owner_name",
    filterField: "owner_name",
  },
  {
    key: "offerLine",
    label: "Offer Line",
    type: "text",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: true,
    sortField: "offer_line",
    filterField: "offer_line",
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: true,
    enumValues: LEAD_STATUSES,
    sortField: "status",
    filterField: "status",
  },
  {
    key: "score",
    label: "Score",
    type: "number",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    sortField: "score",
    filterField: "score",
  },
  {
    key: "scoreReasoning",
    label: "Score Reasoning",
    type: "text",
    sortable: false,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    sortField: "score_reasoning",
    filterField: "score_reasoning",
  },
  {
    key: "sourceType",
    label: "Source",
    type: "enum",
    sortable: true,
    filterable: true,
    editable: false,
    exportable: true,
    defaultVisible: false,
    enumValues: LEAD_SOURCE_TYPES,
    sortField: "source_type",
    filterField: "source_type",
  },
  {
    key: "emails",
    label: "Emails",
    type: "text",
    sortable: false,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    sortField: "emails",
    filterField: "emails",
  },
  {
    key: "rating",
    label: "Rating",
    type: "number",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    sortField: "rating",
    filterField: "rating",
  },
  {
    key: "reviewCount",
    label: "Reviews",
    type: "number",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    sortField: "review_count",
    filterField: "review_count",
  },
  {
    key: "websiteStatus",
    label: "Website Status",
    type: "enum",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    enumValues: WEBSITE_STATUSES,
    sortField: "website_status",
    filterField: "website_status",
  },
  {
    key: "businessSize",
    label: "Business Size",
    type: "enum",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    enumValues: BUSINESS_SIZES,
    sortField: "business_size",
    filterField: "business_size",
  },
  {
    key: "enrichmentStatus",
    label: "Enrichment",
    type: "enum",
    sortable: true,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    enumValues: ENRICHMENT_STATUSES,
    sortField: "enrichment_status",
    filterField: "enrichment_status",
  },
  {
    key: "notes",
    label: "Notes",
    type: "text",
    sortable: false,
    filterable: true,
    editable: true,
    exportable: true,
    defaultVisible: false,
    sortField: "notes",
    filterField: "notes",
  },
  {
    key: "capturedAt",
    label: "Captured",
    type: "date",
    sortable: true,
    filterable: true,
    editable: false,
    exportable: true,
    defaultVisible: false,
    sortField: "captured_at",
    filterField: "captured_at",
  },
  {
    key: "createdAt",
    label: "Created",
    type: "date",
    sortable: true,
    filterable: true,
    editable: false,
    exportable: true,
    defaultVisible: false,
    // Mongoose timestamp — stored as-is (camelCase), not snake_cased.
    sortField: "createdAt",
    filterField: "createdAt",
  },
  {
    key: "parseIssues",
    label: "Parse Issues",
    type: "text",
    sortable: false,
    filterable: false,
    editable: false,
    exportable: true,
    defaultVisible: false,
    sortField: "parse_issues",
    filterField: "parse_issues",
  },
] as const;

const COLUMN_BY_KEY: ReadonlyMap<string, LeadColumnDef> = new Map(
  LEAD_COLUMNS.map((column) => [column.key, column]),
);

/** The static columns visible by default, in catalog order. */
export const DEFAULT_VISIBLE_COLUMNS: readonly string[] = LEAD_COLUMNS.filter(
  (column) => column.defaultVisible,
).map((column) => column.key);

/** A static column definition by key, or undefined for unknown/custom keys. */
export function getColumn(key: string): LeadColumnDef | undefined {
  return COLUMN_BY_KEY.get(key);
}

/** Whether `key` names a static (non-custom-field) catalog column. */
export function isKnownColumnKey(key: string): boolean {
  return COLUMN_BY_KEY.has(key);
}

/** Whether `key` addresses a dynamic custom field (`customFields.<slug>`). */
export function isCustomFieldColumnKey(key: string): boolean {
  return key.startsWith(CUSTOM_FIELD_PREFIX);
}

/** The public column key for a custom field slug (`customFields.<slug>`). */
export function customFieldColumnKey(slug: string): string {
  return `${CUSTOM_FIELD_PREFIX}${slug}`;
}

/**
 * The bare custom-field slug from a `customFields.<slug>` column key, or null
 * when `key` is not a custom-field key.
 */
export function customFieldSlug(key: string): string | null {
  if (!isCustomFieldColumnKey(key)) return null;
  return key.slice(CUSTOM_FIELD_PREFIX.length) || null;
}

/**
 * The stored Mongo path for a custom-field column key
 * (`customFields.foo` → `custom_fields.foo`), or null for a non-custom key.
 */
export function customFieldDbPath(key: string): string | null {
  const slug = customFieldSlug(key);
  return slug ? `${CUSTOM_FIELD_DB_PREFIX}${slug}` : null;
}
