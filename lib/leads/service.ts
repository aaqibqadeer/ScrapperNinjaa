/**
 * lib/leads/service.ts — ScrapperNinja lead-directory business logic (Node).
 *
 * All lead / campaign / saved-view / custom-field reads and writes go through
 * here: the routes stay thin (validate + call), and this layer owns tenant
 * scoping (`session.organizationId`), the scraper feature gate, entitlement
 * checks (lead/campaign caps, CSV export), and translation of query params into
 * the adapter's `{ filter, sort, skip, limit }` via the pure query layer.
 */

import { z } from "zod";

import { features } from "@/config/features";
import type { Session } from "@/lib/auth/types";
import {
  campaignStatusSchema,
  customFieldTypeSchema,
  db,
  leadAddressSchema,
  LEAD_STATUSES,
  leadSourceTypeSchema,
  leadStatusSchema,
  savedViewPageSizeSchema,
  savedViewSortSchema,
  type Campaign,
  type Lead,
  type LeadCustomField,
  type LeadSource,
  type NewLead,
  type SavedView,
} from "@/lib/db";
import { PLAN_FEATURES, requireFeature } from "@/lib/payments/access";
import { enforceCampaignLimit, enforceLeadLimit } from "@/lib/usage/enforce";

import {
  CUSTOM_FIELD_PREFIX,
  customFieldSlug,
  DEFAULT_VISIBLE_COLUMNS,
  getColumn,
  isCustomFieldColumnKey,
} from "./columns";
import { csvHeader, serializeLeadRow } from "./csv";
import {
  buildLeadQuery,
  leadQueryParamsSchema,
  parseLeadQueryFromSearchParams,
  type LeadQueryParams,
} from "./query";

/** Error with an HTTP `status`, served unchanged by `authErrorResponse`. */
export class ScraperError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ScraperError";
    this.status = status;
  }
}

/** 404 when the scraper product is off — every entry point calls this first. */
export function assertScraperEnabled(): void {
  if (!features.scraper.enabled) {
    throw new ScraperError("Not found", 404);
  }
}

export function requireOrg(session: Session): string {
  if (!session.organizationId) {
    throw new ScraperError("No active organization", 400);
  }
  return session.organizationId;
}

async function orgCustomFieldKeys(orgId: string): Promise<string[]> {
  const fields = await db.listLeadCustomFields(orgId);
  return fields.map((field) => field.key);
}

/* -------------------------------------------------------------------------- */
/* Input schemas                                                              */
/* -------------------------------------------------------------------------- */

export const leadCreateSchema = z.object({
  businessName: z.string().min(1).max(300),
  category: z.string().max(200).nullable().optional(),
  phone: z.string().max(100).nullable().optional(),
  website: z.string().max(2000).nullable().optional(),
  ownerName: z.string().max(200).nullable().optional(),
  offerLine: z.string().max(2000).nullable().optional(),
  status: leadStatusSchema.optional(),
  notes: z.string().max(5000).optional(),
  emails: z.array(z.string().max(320)).max(50).optional(),
  address: leadAddressSchema.optional(),
  campaignIds: z.array(z.string().min(1)).max(50).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  sourceType: leadSourceTypeSchema.optional(),
  sourceUrl: z.string().max(2000).nullable().optional(),
});
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadPatchSchema = z.object({
  businessName: z.string().min(1).max(300).optional(),
  phone: z.string().max(100).nullable().optional(),
  website: z.string().max(2000).nullable().optional(),
  ownerName: z.string().max(200).nullable().optional(),
  offerLine: z.string().max(2000).nullable().optional(),
  status: leadStatusSchema.optional(),
  notes: z.string().max(5000).optional(),
  category: z.string().max(200).nullable().optional(),
  emails: z.array(z.string().max(320)).max(50).optional(),
  address: leadAddressSchema.optional(),
  campaignIds: z.array(z.string().min(1)).max(50).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type LeadPatch = z.infer<typeof leadPatchSchema>;

export const bulkActionSchema = z
  .object({
    action: z.enum([
      "set-status",
      "delete",
      "add-campaign",
      "remove-campaign",
      "mark-junk",
    ]),
    ids: z.array(z.string().min(1)).max(10000).optional(),
    selectAll: z.boolean().optional(),
    /** Filter describing the selection when `selectAll` is true. */
    query: leadQueryParamsSchema.partial().optional(),
    /** For `set-status`. */
    status: leadStatusSchema.optional(),
    /** For `add-campaign` / `remove-campaign`. */
    campaignId: z.string().min(1).optional(),
  })
  .refine((v) => v.selectAll === true || (v.ids?.length ?? 0) > 0, {
    message: "Provide ids or selectAll",
  });
export type BulkActionInput = z.infer<typeof bulkActionSchema>;

export const leadImportSchema = z.object({
  /**
   * CSV header → target. A target is a standard lead column key, an existing
   * custom field (`customFields.<slug>`), or `__new__` to auto-create a text
   * custom field from the header.
   */
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.string())).max(5000),
  /** Auto-create missing text custom fields for `__new__`/unknown targets. */
  autoCreateFields: z.boolean().optional(),
});
export type LeadImportInput = z.infer<typeof leadImportSchema>;

/** Sentinel mapping target meaning "make a new text custom field". */
const NEW_CUSTOM_FIELD_MARKER = "__new__";

/** Derive a valid custom-field key (`[a-z0-9_]`) from a CSV header. */
function slugifyCustomFieldKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export const campaignInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  query: z.string().max(500).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  sourceType: leadSourceTypeSchema.nullable().optional(),
  status: campaignStatusSchema.optional(),
});
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export const campaignPatchSchema = campaignInputSchema.partial();
export type CampaignPatch = z.infer<typeof campaignPatchSchema>;

export const savedViewInputSchema = z.object({
  name: z.string().min(1).max(200),
  columns: z.array(z.string().min(1)).max(100).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  sort: savedViewSortSchema.optional(),
  pageSize: savedViewPageSizeSchema.optional(),
  isDefault: z.boolean().optional(),
});
export type SavedViewInput = z.infer<typeof savedViewInputSchema>;
export const savedViewPatchSchema = savedViewInputSchema.partial();
export type SavedViewPatch = z.infer<typeof savedViewPatchSchema>;

export const customFieldInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z0-9_]+$/, "key may only contain letters, digits, underscore"),
  label: z.string().min(1).max(120),
  type: customFieldTypeSchema,
  options: z.array(z.string().min(1).max(120)).max(100).optional(),
  sortOrder: z.number().int().optional(),
});
export type CustomFieldInput = z.infer<typeof customFieldInputSchema>;
export const customFieldPatchSchema = customFieldInputSchema.partial();
export type CustomFieldPatch = z.infer<typeof customFieldPatchSchema>;

/* -------------------------------------------------------------------------- */
/* Leads — read                                                               */
/* -------------------------------------------------------------------------- */

export interface ListLeadsResponse {
  leads: Lead[];
  total: number;
  page: number;
  pageSize: number;
}

async function resolveParams(
  input: URLSearchParams | LeadQueryParams,
  customFieldKeys: string[],
): Promise<LeadQueryParams> {
  if (input instanceof URLSearchParams) {
    return parseLeadQueryFromSearchParams(input, customFieldKeys);
  }
  return leadQueryParamsSchema.parse(input);
}

export async function listLeadsForOrg(
  session: Session,
  input: URLSearchParams | LeadQueryParams,
): Promise<ListLeadsResponse> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const keys = await orgCustomFieldKeys(orgId);
  const params = await resolveParams(input, keys);
  const { filter, sort, skip, limit } = buildLeadQuery(orgId, params, keys);
  const { leads, total } = await db.listLeads(orgId, {
    filter,
    sort,
    skip,
    limit,
  });
  return { leads, total, page: params.page, pageSize: params.pageSize };
}

export async function getLead(session: Session, id: string): Promise<Lead> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const lead = await db.getLeadById(orgId, id);
  if (!lead) throw new ScraperError("Lead not found", 404);
  return lead;
}

/**
 * Provenance rows for one lead (`lead_sources`). Verifies the lead belongs to
 * the caller's org first, so the raw payloads never leak across tenants.
 */
export async function listLeadSources(
  session: Session,
  leadId: string,
): Promise<LeadSource[]> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const lead = await db.getLeadById(orgId, leadId);
  if (!lead) throw new ScraperError("Lead not found", 404);
  return db.listLeadSourcesForLead(orgId, leadId);
}

/* -------------------------------------------------------------------------- */
/* Leads — write                                                              */
/* -------------------------------------------------------------------------- */

/** Build a `NewLead` from validated create input, applying defaults. */
function toNewLead(
  orgId: string,
  session: Session,
  input: LeadCreateInput,
): NewLead {
  return {
    organizationId: orgId,
    campaignIds: input.campaignIds ?? [],
    sourceType: input.sourceType ?? "manual",
    sourceUrl: input.sourceUrl ?? null,
    capturedAt: new Date(),
    capturedByUserId: session.user.id,
    businessName: input.businessName,
    category: input.category ?? null,
    categories: [],
    phone: input.phone ?? null,
    website: input.website ?? null,
    ownerName: input.ownerName ?? null,
    offerLine: input.offerLine ?? null,
    emails: input.emails ?? [],
    socials: {},
    techStack: [],
    pageSpeed: {},
    businessSize: "unknown",
    websiteStatus: "unknown",
    address: input.address ?? {},
    status: input.status ?? "new",
    notes: input.notes ?? "",
    customFields: input.customFields ?? {},
    parseIssues: [],
    dedupeKeys: [],
  };
}

export async function createLead(
  session: Session,
  input: LeadCreateInput,
): Promise<Lead> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const current = await db.countLeads(orgId);
  await enforceLeadLimit(session, current);
  return db.createLead(toNewLead(orgId, session, input));
}

export async function updateLead(
  session: Session,
  id: string,
  patch: LeadPatch,
): Promise<Lead> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const existing = await db.getLeadById(orgId, id);
  if (!existing) throw new ScraperError("Lead not found", 404);
  // A user editing the offer line marks it hand-edited so the offer AI pass can
  // skip it (skipEdited) and never clobber a human's copy.
  const writes: LeadPatch & { offerLineEditedAt?: Date } = { ...patch };
  if (patch.offerLine !== undefined && patch.offerLine !== existing.offerLine) {
    writes.offerLineEditedAt = new Date();
  }
  return db.updateLead(orgId, id, writes);
}

export async function deleteLead(session: Session, id: string): Promise<void> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const existing = await db.getLeadById(orgId, id);
  if (!existing) throw new ScraperError("Lead not found", 404);
  await db.deleteLead(orgId, id);
}

/** Collect the lead ids a bulk action targets (explicit ids or `selectAll`). */
async function resolveBulkIds(
  orgId: string,
  input: BulkActionInput,
): Promise<string[]> {
  if (input.selectAll) {
    const params = leadQueryParamsSchema.parse(input.query ?? {});
    const keys = await orgCustomFieldKeys(orgId);
    const { filter, sort } = buildLeadQuery(orgId, params, keys);
    const ids: string[] = [];
    for await (const lead of db.streamLeads(orgId, filter, sort)) {
      ids.push(lead.id);
    }
    return ids;
  }
  return input.ids ?? [];
}

/** Add/remove a campaign from each lead individually (adapter has no set-op). */
async function applyCampaignMembership(
  orgId: string,
  ids: string[],
  campaignId: string,
  add: boolean,
): Promise<number> {
  let affected = 0;
  for (const id of ids) {
    const lead = await db.getLeadById(orgId, id);
    if (!lead) continue;
    const has = lead.campaignIds.includes(campaignId);
    if (add === has) continue;
    const next = add
      ? [...lead.campaignIds, campaignId]
      : lead.campaignIds.filter((c) => c !== campaignId);
    await db.updateLead(orgId, id, { campaignIds: next });
    affected += 1;
  }
  if (affected > 0) {
    await db.incrementCampaignLeadCount(
      orgId,
      campaignId,
      add ? affected : -affected,
    );
  }
  return affected;
}

export async function bulkAction(
  session: Session,
  input: BulkActionInput,
): Promise<number> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const ids = await resolveBulkIds(orgId, input);
  if (ids.length === 0) return 0;

  switch (input.action) {
    case "delete":
      return db.bulkDeleteLeads(orgId, ids);
    case "mark-junk":
      return db.bulkUpdateLeads(orgId, ids, { status: "junk" });
    case "set-status": {
      if (!input.status) {
        throw new ScraperError("status is required for set-status", 400);
      }
      return db.bulkUpdateLeads(orgId, ids, { status: input.status });
    }
    case "add-campaign":
    case "remove-campaign": {
      if (!input.campaignId) {
        throw new ScraperError("campaignId is required", 400);
      }
      const campaign = await db.getCampaignById(orgId, input.campaignId);
      if (!campaign) throw new ScraperError("Campaign not found", 404);
      return applyCampaignMembership(
        orgId,
        ids,
        input.campaignId,
        input.action === "add-campaign",
      );
    }
    default:
      throw new ScraperError("Unknown bulk action", 400);
  }
}

/* -------------------------------------------------------------------------- */
/* Leads — export (CSV stream)                                                */
/* -------------------------------------------------------------------------- */

/** Whitelist requested export columns to exportable + valid custom fields. */
function resolveExportColumns(
  requested: string[] | undefined,
  customFieldKeys: string[],
): string[] {
  const source =
    requested && requested.length > 0 ? requested : [...DEFAULT_VISIBLE_COLUMNS];
  const out: string[] = [];
  for (const key of source) {
    if (isCustomFieldColumnKey(key)) {
      const slug = customFieldSlug(key);
      if (slug && customFieldKeys.includes(slug)) out.push(key);
      continue;
    }
    const column = getColumn(key);
    if (column && column.exportable) out.push(key);
  }
  return out.length > 0 ? out : [...DEFAULT_VISIBLE_COLUMNS];
}

/**
 * A streaming CSV of all matching leads (not capped by pageSize). Gated by the
 * `dataExport` entitlement — the UI hides the button, this enforces it.
 */
export async function exportLeadsCsv(
  session: Session,
  input: URLSearchParams | LeadQueryParams,
  columns?: string[],
): Promise<ReadableStream<Uint8Array>> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  await requireFeature(session, PLAN_FEATURES.dataExport);
  const keys = await orgCustomFieldKeys(orgId);
  const params = await resolveParams(input, keys);
  const { filter, sort } = buildLeadQuery(orgId, params, keys);
  const exportColumns = resolveExportColumns(columns, keys);

  const encoder = new TextEncoder();
  const iterator = db.streamLeads(orgId, filter, sort)[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(csvHeader(exportColumns) + "\n"));
    },
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(serializeLeadRow(value, exportColumns) + "\n"),
      );
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Leads — import (mapped rows)                                               */
/* -------------------------------------------------------------------------- */

export interface ImportResult {
  created: number;
  skipped: number;
}

/** Turn one mapped row (keyed by column key) into create input, or null. */
function mappedRowToCreateInput(
  mapped: Record<string, string>,
): LeadCreateInput | null {
  const businessName = mapped.businessName?.trim();
  if (!businessName) return null;

  const address: Record<string, string> = {};
  if (mapped.city?.trim()) address.city = mapped.city.trim();
  if (mapped.state?.trim()) address.state = mapped.state.trim();

  const emails = mapped.emails
    ? mapped.emails
        .split(/[;,]/)
        .map((e) => e.trim())
        .filter((e) => e.length > 0)
    : undefined;

  const statusRaw = mapped.status?.trim();
  const status = (LEAD_STATUSES as readonly string[]).includes(statusRaw ?? "")
    ? (statusRaw as LeadCreateInput["status"])
    : undefined;

  return {
    businessName,
    phone: mapped.phone?.trim() || null,
    website: mapped.website?.trim() || null,
    category: mapped.category?.trim() || null,
    ownerName: mapped.ownerName?.trim() || null,
    offerLine: mapped.offerLine?.trim() || null,
    notes: mapped.notes?.trim() || undefined,
    emails,
    address: Object.keys(address).length > 0 ? address : undefined,
    status,
    sourceType: "csv",
  };
}

export async function importLeadsCsv(
  session: Session,
  input: LeadImportInput,
): Promise<ImportResult> {
  assertScraperEnabled();
  const orgId = requireOrg(session);

  // Resolve custom-field targets in the mapping and ensure each one exists,
  // creating missing text fields when the header asked for a new field (or an
  // unknown custom target and `autoCreateFields` is set).
  const existingFields = await db.listLeadCustomFields(orgId);
  const fieldByKey = new Map(existingFields.map((f) => [f.key, f]));
  const resolvedMapping: Record<string, string> = {};
  const fieldsToCreate = new Map<string, string>();

  for (const [header, target] of Object.entries(input.mapping)) {
    if (!target) continue;
    if (target === NEW_CUSTOM_FIELD_MARKER) {
      const slug = slugifyCustomFieldKey(header);
      if (!slug) continue;
      resolvedMapping[header] = `${CUSTOM_FIELD_PREFIX}${slug}`;
      if (!fieldByKey.has(slug) && !fieldsToCreate.has(slug)) {
        fieldsToCreate.set(slug, header.trim() || slug);
      }
    } else if (isCustomFieldColumnKey(target)) {
      const slug = customFieldSlug(target);
      if (!slug) continue;
      if (fieldByKey.has(slug)) {
        resolvedMapping[header] = target;
      } else if (input.autoCreateFields) {
        resolvedMapping[header] = target;
        if (!fieldsToCreate.has(slug)) {
          fieldsToCreate.set(slug, header.trim() || slug);
        }
      }
      // Unknown custom target without auto-create: silently dropped.
    } else {
      resolvedMapping[header] = target; // standard column key
    }
  }

  let nextSortOrder = existingFields.length;
  for (const [key, label] of fieldsToCreate) {
    if (fieldByKey.has(key)) continue;
    const created = await db.createLeadCustomField({
      organizationId: orgId,
      key,
      label,
      type: "text",
      options: [],
      sortOrder: nextSortOrder++,
    });
    fieldByKey.set(key, created);
  }

  // Apply the resolved mapping to each row, splitting standard columns from
  // custom-field values.
  const mappedRows = input.rows.map((row) => {
    const mapped: Record<string, string> = {};
    const custom: Record<string, string> = {};
    for (const [header, columnKey] of Object.entries(resolvedMapping)) {
      const value = row[header];
      if (value === undefined) continue;
      if (isCustomFieldColumnKey(columnKey)) {
        const slug = customFieldSlug(columnKey);
        if (slug && fieldByKey.has(slug)) custom[slug] = value;
      } else {
        mapped[columnKey] = value;
      }
    }
    return { mapped, custom };
  });

  const candidates = mappedRows
    .map(({ mapped, custom }): LeadCreateInput | null => {
      const base = mappedRowToCreateInput(mapped);
      if (!base) return null;
      const trimmed: Record<string, string> = {};
      for (const [key, value] of Object.entries(custom)) {
        if (value.trim().length > 0) trimmed[key] = value.trim();
      }
      if (Object.keys(trimmed).length > 0) base.customFields = trimmed;
      return base;
    })
    .filter((c): c is LeadCreateInput => c !== null);
  const skipped = input.rows.length - candidates.length;

  if (candidates.length === 0) return { created: 0, skipped };

  // Batch cap check: the last lead is created when the count reaches
  // current + candidates.length - 1, which must stay under the plan limit.
  const current = await db.countLeads(orgId);
  await enforceLeadLimit(session, current + candidates.length - 1);

  let created = 0;
  for (const candidate of candidates) {
    await db.createLead(toNewLead(orgId, session, candidate));
    created += 1;
  }
  return { created, skipped };
}

/* -------------------------------------------------------------------------- */
/* Campaigns                                                                  */
/* -------------------------------------------------------------------------- */

export async function listCampaigns(session: Session): Promise<Campaign[]> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  return db.listCampaigns(orgId);
}

export async function getCampaign(
  session: Session,
  id: string,
): Promise<Campaign> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const campaign = await db.getCampaignById(orgId, id);
  if (!campaign) throw new ScraperError("Campaign not found", 404);
  return campaign;
}

export async function createCampaign(
  session: Session,
  input: CampaignInput,
): Promise<Campaign> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const current = (await db.listCampaigns(orgId)).length;
  await enforceCampaignLimit(session, current);
  return db.createCampaign({
    organizationId: orgId,
    name: input.name,
    description: input.description ?? null,
    query: input.query ?? null,
    location: input.location ?? null,
    sourceType: input.sourceType ?? null,
    status: input.status ?? "active",
    leadCount: 0,
    createdByUserId: session.user.id,
  });
}

export async function updateCampaign(
  session: Session,
  id: string,
  patch: CampaignPatch,
): Promise<Campaign> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const existing = await db.getCampaignById(orgId, id);
  if (!existing) throw new ScraperError("Campaign not found", 404);
  return db.updateCampaign(orgId, id, patch);
}

export async function deleteCampaign(
  session: Session,
  id: string,
): Promise<void> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const existing = await db.getCampaignById(orgId, id);
  if (!existing) throw new ScraperError("Campaign not found", 404);
  await db.deleteCampaign(orgId, id);
}

/* -------------------------------------------------------------------------- */
/* Saved views                                                                */
/* -------------------------------------------------------------------------- */

export async function listSavedViews(session: Session): Promise<SavedView[]> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  return db.listSavedViews(orgId, session.user.id);
}

export async function createSavedView(
  session: Session,
  input: SavedViewInput,
): Promise<SavedView> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  return db.createSavedView({
    organizationId: orgId,
    userId: session.user.id,
    name: input.name,
    columns: input.columns ?? [...DEFAULT_VISIBLE_COLUMNS],
    filters: input.filters ?? {},
    sort: input.sort ?? { key: "createdAt", dir: "desc" },
    pageSize: input.pageSize ?? 25,
    isDefault: input.isDefault ?? false,
  });
}

async function requireOwnSavedView(
  session: Session,
  orgId: string,
  id: string,
): Promise<SavedView> {
  const views = await db.listSavedViews(orgId, session.user.id);
  const view = views.find((v) => v.id === id);
  if (!view) throw new ScraperError("Saved view not found", 404);
  return view;
}

export async function updateSavedView(
  session: Session,
  id: string,
  patch: SavedViewPatch,
): Promise<SavedView> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  await requireOwnSavedView(session, orgId, id);
  return db.updateSavedView(orgId, id, patch);
}

export async function deleteSavedView(
  session: Session,
  id: string,
): Promise<void> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  await requireOwnSavedView(session, orgId, id);
  await db.deleteSavedView(orgId, id);
}

/* -------------------------------------------------------------------------- */
/* Custom fields                                                              */
/* -------------------------------------------------------------------------- */

export async function listCustomFields(
  session: Session,
): Promise<LeadCustomField[]> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  return db.listLeadCustomFields(orgId);
}

export async function createCustomField(
  session: Session,
  input: CustomFieldInput,
): Promise<LeadCustomField> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const existing = await db.listLeadCustomFields(orgId);
  if (existing.some((field) => field.key === input.key)) {
    throw new ScraperError(`A custom field "${input.key}" already exists`, 409);
  }
  return db.createLeadCustomField({
    organizationId: orgId,
    key: input.key,
    label: input.label,
    type: input.type,
    options: input.options ?? [],
    sortOrder: input.sortOrder ?? existing.length,
  });
}

export async function updateCustomField(
  session: Session,
  id: string,
  patch: CustomFieldPatch,
): Promise<LeadCustomField> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const existing = await db.listLeadCustomFields(orgId);
  const target = existing.find((field) => field.id === id);
  if (!target) throw new ScraperError("Custom field not found", 404);
  if (
    patch.key !== undefined &&
    patch.key !== target.key &&
    existing.some((field) => field.key === patch.key)
  ) {
    throw new ScraperError(`A custom field "${patch.key}" already exists`, 409);
  }
  return db.updateLeadCustomField(orgId, id, patch);
}

export async function deleteCustomField(
  session: Session,
  id: string,
): Promise<void> {
  assertScraperEnabled();
  const orgId = requireOrg(session);
  const existing = await db.listLeadCustomFields(orgId);
  if (!existing.some((field) => field.id === id)) {
    throw new ScraperError("Custom field not found", 404);
  }
  await db.deleteLeadCustomField(orgId, id);
}
