"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  Filter,
  Pencil,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { JobsPanel } from "@/components/jobs/JobsPanel";
import {
  RunAiPassDialog,
  type JobSelection,
} from "@/components/jobs/RunAiPassDialog";
import { CampaignPicker } from "@/components/leads/CampaignPicker";
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer";
import { BulkActionBar } from "@/components/shared/BulkActionBar";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import {
  ColumnFilter,
  type ColumnFilterType,
  type ColumnFilterValue,
  type RangeFilterValue,
} from "@/components/shared/ColumnFilter";
import { ColumnPicker } from "@/components/shared/ColumnPicker";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  CsvImportDialog,
  type CsvImportPayload,
  type CsvImportResult,
} from "@/components/shared/CsvImportDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pagination } from "@/components/shared/Pagination";
import { SavedViewsMenu } from "@/components/shared/SavedViewsMenu";
import { SortableHeader } from "@/components/shared/SortableHeader";
import { InlineEditCell } from "@/components/shared/InlineEditCell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  customFieldColumnKey,
  customFieldSlug,
  DEFAULT_VISIBLE_COLUMNS,
  LEAD_COLUMNS,
  type ColumnType,
} from "@/lib/leads/columns";
import {
  CUSTOM_FIELD_TYPES,
  LEAD_STATUSES,
  type Campaign,
  type CustomFieldType,
  type Lead,
  type LeadAddress,
  type LeadCustomField,
  type LeadStatus,
  type SavedView as SavedViewRecord,
  type SavedViewPageSize,
} from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format/datetime";
import { cn } from "@/lib/utils";

export interface LeadsTableProps {
  canExport?: boolean;
  exportPlan?: string | null;
}

/** A resolved table column (static catalog column or dynamic custom field). */
interface TableColumn {
  key: string;
  label: string;
  type: ColumnType;
  filterType: ColumnFilterType;
  sortable: boolean;
  filterable: boolean;
  editable: boolean;
  enumValues: string[];
  isCustom: boolean;
}

const EDITABLE_TEXT_KEYS = new Set([
  "businessName",
  "phone",
  "website",
  "ownerName",
  "offerLine",
  "notes",
]);

const PAGE_SIZE_OPTIONS: SavedViewPageSize[] = [25, 50, 100, 250];

/** A single column's filter directives sent as `f.<col>...` params. */
interface FilterSpec {
  text?: string;
  min?: string;
  max?: string;
  in?: string[];
}

/** The manual "Add lead" form (custom-field values are tracked separately). */
interface AddLeadForm {
  businessName: string;
  phone: string;
  website: string;
  category: string;
  ownerName: string;
  status: LeadStatus;
  notes: string;
  emails: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  campaignId: string;
}

const EMPTY_ADD_FORM: AddLeadForm = {
  businessName: "",
  phone: "",
  website: "",
  category: "",
  ownerName: "",
  status: "new",
  notes: "",
  emails: "",
  street: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  campaignId: "",
};

function buildColumns(customFields: LeadCustomField[]): TableColumn[] {
  const staticColumns: TableColumn[] = LEAD_COLUMNS.map((column) => ({
    key: column.key,
    label: column.label,
    type: column.type,
    filterType: column.type,
    sortable: column.sortable,
    filterable: column.filterable,
    editable: column.editable,
    enumValues: [...(column.enumValues ?? [])],
    isCustom: false,
  }));
  const customColumns: TableColumn[] = customFields.map((field) => {
    const type: ColumnType =
      field.type === "select" ? "enum" : (field.type as ColumnType);
    return {
      key: customFieldColumnKey(field.key),
      label: field.label,
      type,
      filterType: type,
      sortable: true,
      filterable: true,
      editable: false,
      enumValues: field.type === "select" ? [...field.options] : [],
      isCustom: true,
    };
  });
  return [...staticColumns, ...customColumns];
}

/** Reduce the live filter state to `{ col: spec }`, dropping empty entries. */
function toFilterSpecs(
  filters: Record<string, ColumnFilterValue>,
  columns: TableColumn[],
): Record<string, FilterSpec> {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const out: Record<string, FilterSpec> = {};
  for (const [key, value] of Object.entries(filters)) {
    const column = byKey.get(key);
    if (!column || value === undefined) continue;
    if (column.filterType === "text") {
      if (typeof value === "string" && value.trim().length > 0) {
        out[key] = { text: value.trim() };
      }
    } else if (column.filterType === "number" || column.filterType === "date") {
      const range = value as RangeFilterValue;
      const spec: FilterSpec = {};
      if (range.min) spec.min = range.min;
      if (range.max) spec.max = range.max;
      if (spec.min || spec.max) out[key] = spec;
    } else if (column.filterType === "enum") {
      if (Array.isArray(value) && value.length > 0) out[key] = { in: value };
    } else if (column.filterType === "boolean") {
      if (typeof value === "string" && value.length > 0) {
        out[key] = { in: [value] };
      }
    }
  }
  return out;
}

/** Restore live filter state from a stored saved-view `filters` blob. */
function specsToFilters(
  stored: Record<string, unknown>,
): Record<string, ColumnFilterValue> {
  const out: Record<string, ColumnFilterValue> = {};
  for (const [key, raw] of Object.entries(stored)) {
    if (!raw || typeof raw !== "object") continue;
    const spec = raw as FilterSpec;
    if (Array.isArray(spec.in)) out[key] = spec.in;
    else if (spec.min !== undefined || spec.max !== undefined) {
      out[key] = { min: spec.min, max: spec.max };
    } else if (typeof spec.text === "string") out[key] = spec.text;
  }
  return out;
}

/** All known top-level search params LeadsTable owns (for URL round-trips). */
const OWNED_URL_KEYS = [
  "q",
  "status",
  "campaignId",
  "sessionId",
  "sort",
  "dir",
  "page",
  "pageSize",
  "includeJunk",
  "notEnriched",
  "missingOfferLine",
];

/** A snapshot of the current URL search params (client-only, once at mount). */
function readInitialSearch(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/** Reconstruct column-filter state from `f.<col>[.op]=…` URL params. */
function readColumnFiltersFromSearch(
  params: URLSearchParams,
): Record<string, ColumnFilterValue> {
  const specs: Record<string, FilterSpec> = {};
  const ensure = (col: string): FilterSpec => (specs[col] ??= {});
  for (const [rawKey, value] of params.entries()) {
    if (!rawKey.startsWith("f.")) continue;
    const body = rawKey.slice(2);
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
  return specsToFilters(specs);
}

export function LeadsTable({
  canExport = true,
  exportPlan,
}: LeadsTableProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  // Snapshot the URL once, at mount, to seed initial state (client-only). We
  // then own the URL going forward via router.replace — never reading it back
  // reactively — so writes can't loop with reads.
  const initialSearchRef = useRef<URLSearchParams>(undefined);
  if (!initialSearchRef.current) initialSearchRef.current = readInitialSearch();
  const init = initialSearchRef.current;
  const truthyParam = (key: string): boolean => {
    const v = init.get(key);
    return v === "1" || v === "true";
  };

  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [rescuing, setRescuing] = useState(false);

  const [page, setPage] = useState<number>(() => {
    const n = Number(init.get("page"));
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  });
  const [pageSize, setPageSize] = useState<SavedViewPageSize>(() => {
    const n = Number(init.get("pageSize"));
    return (PAGE_SIZE_OPTIONS as number[]).includes(n)
      ? (n as SavedViewPageSize)
      : 25;
  });
  const [sortKey, setSortKey] = useState<string>(
    () => init.get("sort") || "createdAt",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() =>
    init.get("dir") === "asc" ? "asc" : "desc",
  );

  const [qInput, setQInput] = useState(() => init.get("q") ?? "");
  const [q, setQ] = useState(() => init.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "">(() => {
    const s = init.get("status");
    return (LEAD_STATUSES as readonly string[]).includes(s ?? "")
      ? (s as LeadStatus)
      : "";
  });
  const [notEnriched, setNotEnriched] = useState(() =>
    truthyParam("notEnriched"),
  );
  const [missingOfferLine, setMissingOfferLine] = useState(() =>
    truthyParam("missingOfferLine"),
  );
  const [duplicatesCount, setDuplicatesCount] = useState<number | null>(null);
  const [runAiOpen, setRunAiOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(
    () => init.get("campaignId"),
  );
  const [sessionId, setSessionId] = useState<string | null>(
    () => init.get("sessionId"),
  );
  const [includeJunk, setIncludeJunk] = useState(() =>
    truthyParam("includeJunk"),
  );
  const [columnFilters, setColumnFilters] = useState<
    Record<string, ColumnFilterValue>
  >(() => readColumnFiltersFromSearch(init));

  // Bulk "edit mode" over the current page: staged patches keyed by lead id.
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty] = useState<Record<string, Record<string, unknown>>>(
    {},
  );
  const [savingAll, setSavingAll] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  const [customFields, setCustomFields] = useState<LeadCustomField[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    ...DEFAULT_VISIBLE_COLUMNS,
  ]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [views, setViews] = useState<SavedViewRecord[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [bulkCampaignId, setBulkCampaignId] = useState("");

  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  /** Delay row→drawer so a double-click can win for inline edit. */
  const detailClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [addForm, setAddForm] = useState<AddLeadForm>(EMPTY_ADD_FORM);
  const [addCustomValues, setAddCustomValues] = useState<
    Record<string, string>
  >({});
  const [addBusy, setAddBusy] = useState(false);
  // Inline "Add custom field" creator inside the Add-lead dialog.
  const [addCfOpen, setAddCfOpen] = useState(false);
  const [addCfBusy, setAddCfBusy] = useState(false);
  const [newCf, setNewCf] = useState<{
    key: string;
    label: string;
    type: CustomFieldType;
    options: string;
  }>({ key: "", label: "", type: "text", options: "" });

  const columns = useMemo(() => buildColumns(customFields), [customFields]);
  const columnByKey = useMemo(
    () => new Map(columns.map((c) => [c.key, c])),
    [columns],
  );
  const filterSpecs = useMemo(
    () => toFilterSpecs(columnFilters, columns),
    [columnFilters, columns],
  );

  /** Debounce the search box into the fetched `q`. */
  useEffect(() => {
    const handle = setTimeout(() => {
      setQ(qInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [qInput]);

  const buildParams = useCallback(
    (includePaging: boolean): URLSearchParams => {
      const params = new URLSearchParams();
      if (includePaging) {
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
      }
      params.set("sort", sortKey);
      params.set("dir", sortDir);
      if (q) params.set("q", q);
      if (statusFilter) params.set("status", statusFilter);
      if (campaignId) params.set("campaignId", campaignId);
      // Coordinated with the query layer: the API reads `sessionId` (mapped to
      // the `captureSessionId` filter). Sent even if the server side isn't
      // wired yet — it's ignored until then.
      if (sessionId) params.set("sessionId", sessionId);
      if (includeJunk) params.set("includeJunk", "1");
      if (notEnriched) params.set("notEnriched", "1");
      if (missingOfferLine) params.set("missingOfferLine", "1");
      for (const [key, spec] of Object.entries(filterSpecs)) {
        if (spec.in) params.set(`f.${key}.in`, spec.in.join(","));
        else if (spec.min !== undefined || spec.max !== undefined) {
          if (spec.min) params.set(`f.${key}.min`, spec.min);
          if (spec.max) params.set(`f.${key}.max`, spec.max);
        } else if (spec.text !== undefined) params.set(`f.${key}`, spec.text);
      }
      return params;
    },
    [
      page,
      pageSize,
      sortKey,
      sortDir,
      q,
      statusFilter,
      campaignId,
      sessionId,
      includeJunk,
      notEnriched,
      missingOfferLine,
      filterSpecs,
    ],
  );

  /** The query object handed to the bulk endpoint for "select all matching". */
  const selectionQuery = useCallback(
    () => ({
      sort: sortKey,
      dir: sortDir,
      ...(q ? { q } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(sessionId ? { sessionId } : {}),
      includeJunk,
      ...(notEnriched ? { notEnriched: true } : {}),
      ...(missingOfferLine ? { missingOfferLine: true } : {}),
      filters: filterSpecs,
    }),
    [
      sortKey,
      sortDir,
      q,
      statusFilter,
      campaignId,
      sessionId,
      includeJunk,
      notEnriched,
      missingOfferLine,
      filterSpecs,
    ],
  );

  /** Resolve the current selection for an AI-pass job (ids or selectAll). */
  const getJobSelection = useCallback(
    (): JobSelection =>
      allMatching
        ? { query: selectionQuery() }
        : { leadIds: Array.from(selected) },
    [allMatching, selectionQuery, selected],
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Persist the live view to the URL (replace, not push — no history spam) so a
  // refresh or back-button restores it. Unknown params are preserved; only the
  // keys we own (and every `f.*`) are rewritten, and defaults are omitted to
  // keep a pristine view's URL clean.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of OWNED_URL_KEYS) params.delete(key);
    for (const key of [...params.keys()]) {
      if (key.startsWith("f.")) params.delete(key);
    }
    if (q) params.set("q", q);
    if (statusFilter) params.set("status", statusFilter);
    if (campaignId) params.set("campaignId", campaignId);
    if (sessionId) params.set("sessionId", sessionId);
    if (sortKey && sortKey !== "createdAt") params.set("sort", sortKey);
    if (sortDir !== "desc") params.set("dir", sortDir);
    if (page > 1) params.set("page", String(page));
    if (pageSize !== 25) params.set("pageSize", String(pageSize));
    if (includeJunk) params.set("includeJunk", "1");
    if (notEnriched) params.set("notEnriched", "1");
    if (missingOfferLine) params.set("missingOfferLine", "1");
    for (const [key, spec] of Object.entries(filterSpecs)) {
      if (spec.in) params.set(`f.${key}.in`, spec.in.join(","));
      else if (spec.min !== undefined || spec.max !== undefined) {
        if (spec.min) params.set(`f.${key}.min`, spec.min);
        if (spec.max) params.set(`f.${key}.max`, spec.max);
      } else if (spec.text !== undefined) params.set(`f.${key}`, spec.text);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [
    q,
    statusFilter,
    campaignId,
    sessionId,
    sortKey,
    sortDir,
    page,
    pageSize,
    includeJunk,
    notEnriched,
    missingOfferLine,
    filterSpecs,
    pathname,
    router,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const res = await fetch(`/api/leads?${buildParams(true).toString()}`);
      if (cancelled) return;
      if (res.ok) {
        const data = (await res.json()) as { leads: Lead[]; total: number };
        setLeads(data.leads);
        setTotal(data.total);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setLeads([]);
        setTotal(0);
        toast.error(data.error ?? "Could not load leads");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [buildParams, nonce]);

  // Track the size of the needs-review queue independently of the current
  // filters, so the chip badge + Rescue button reflect the whole org.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // `total` is what we need; pageSize is the smallest the schema allows
      // (25/50/100/250) — the count is independent of the page window.
      const res = await fetch("/api/leads?status=needs_review&pageSize=25");
      if (cancelled || !res.ok) return;
      const data = (await res.json().catch(() => ({}))) as { total?: number };
      setNeedsReviewCount(data.total ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Pending duplicate-candidate count for the "possible duplicates" chip. Stays
  // null (chip hidden) when the duplicates API isn't available yet (404).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/duplicates?status=pending").catch(
        () => null,
      );
      if (cancelled || !res || !res.ok) return;
      const data = (await res.json().catch(() => ({}))) as {
        candidates?: unknown[];
      };
      setDuplicatesCount(data.candidates?.length ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    void (async () => {
      const [campaignsRes, viewsRes, fieldsRes] = await Promise.all([
        fetch("/api/campaigns"),
        fetch("/api/views"),
        fetch("/api/custom-fields"),
      ]);
      if (campaignsRes.ok) {
        const data = (await campaignsRes.json()) as { campaigns: Campaign[] };
        setCampaigns(data.campaigns);
      }
      if (fieldsRes.ok) {
        const data = (await fieldsRes.json()) as { fields: LeadCustomField[] };
        setCustomFields(data.fields);
      }
      if (viewsRes.ok) {
        const data = (await viewsRes.json()) as { views: SavedViewRecord[] };
        setViews(data.views);
        const def = data.views.find((v) => v.isDefault);
        if (def) applyView(def);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  /** Change a filter/sort input and return to page 1 with a clean selection. */
  function withReset(fn: () => void) {
    fn();
    setPage(1);
    resetSelection();
  }

  function handleSort(key: string) {
    withReset(() => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    });
    setActiveViewId(null);
  }

  function setColumnFilter(key: string, value: ColumnFilterValue) {
    withReset(() => setColumnFilters((prev) => ({ ...prev, [key]: value })));
    setActiveViewId(null);
  }

  function clearColumnFilter(key: string) {
    withReset(() =>
      setColumnFilters((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      }),
    );
  }

  function applyView(view: SavedViewRecord) {
    if (view.columns.length > 0) setVisibleColumns([...view.columns]);
    setColumnFilters(specsToFilters(view.filters));
    setSortKey(view.sort.key);
    setSortDir(view.sort.dir);
    setPageSize(view.pageSize);
    setPage(1);
    resetSelection();
    setActiveViewId(view.id);
  }

  async function saveLeadField(id: string, patch: Record<string, unknown>) {
    setLeads(
      (prev) =>
        prev?.map((lead) =>
          lead.id === id ? ({ ...lead, ...patch } as Lead) : lead,
        ) ?? null,
    );
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "Could not save the change");
      reload();
    }
  }

  /** In edit mode, stage a change locally (optimistic); else persist now. */
  function editCell(id: string, patch: Record<string, unknown>) {
    if (!editMode) {
      void saveLeadField(id, patch);
      return;
    }
    setLeads(
      (prev) =>
        prev?.map((lead) =>
          lead.id === id ? ({ ...lead, ...patch } as Lead) : lead,
        ) ?? null,
    );
    setDirty((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));
  }

  /** Persist every staged row with a sequential PATCH; keep failures dirty. */
  async function saveAllEdits() {
    const entries = Object.entries(dirty);
    if (entries.length === 0) return;
    setSavingAll(true);
    const remaining: Record<string, Record<string, unknown>> = {};
    let saved = 0;
    for (const [id, patch] of entries) {
      try {
        const res = await fetch(`/api/leads/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) saved += 1;
        else remaining[id] = patch;
      } catch {
        remaining[id] = patch;
      }
    }
    setDirty(remaining);
    setSavingAll(false);
    const failed = Object.keys(remaining).length;
    if (failed === 0) {
      toast.success(`Saved ${saved} lead${saved === 1 ? "" : "s"}`);
      reload();
    } else {
      toast.error(
        `Saved ${saved}, ${failed} failed — those rows are still editing.`,
      );
    }
  }

  /** Drop staged edits and reload the server's authoritative rows. */
  function discardEdits() {
    setDirty({});
    reload();
  }

  function requestExitEditMode() {
    if (Object.keys(dirty).length > 0) {
      setExitConfirmOpen(true);
      return;
    }
    setEditMode(false);
  }

  function confirmExitDiscard() {
    setDirty({});
    setEditMode(false);
    setExitConfirmOpen(false);
    reload();
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = allMatching
        ? new Set((leads ?? []).map((l) => l.id))
        : new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setAllMatching(false);
  }

  function togglePage(checked: boolean) {
    setAllMatching(false);
    setSelected(checked ? new Set((leads ?? []).map((l) => l.id)) : new Set());
  }

  async function runBulk(body: Record<string, unknown>): Promise<void> {
    const selection = allMatching
      ? { selectAll: true, query: selectionQuery() }
      : { ids: Array.from(selected) };
    const res = await fetch("/api/leads/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...selection }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      affected?: number;
      error?: string;
    };
    if (!res.ok) {
      toast.error(data.error ?? "Bulk action failed");
      return;
    }
    toast.success(`Updated ${data.affected ?? 0} lead(s)`);
    resetSelection();
    reload();
  }

  function resetAddForm() {
    setAddForm(EMPTY_ADD_FORM);
    setAddCustomValues({});
    setAddCfOpen(false);
    setNewCf({ key: "", label: "", type: "text", options: "" });
  }

  /** Coerce the string-keyed custom-field inputs into typed payload values. */
  function buildCustomFieldsPayload(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of customFields) {
      const raw = addCustomValues[field.key];
      if (raw === undefined || raw === "") continue;
      if (field.type === "number") {
        const n = Number(raw);
        if (Number.isFinite(n)) out[field.key] = n;
      } else if (field.type === "boolean") {
        out[field.key] = raw === "true";
      } else {
        out[field.key] = raw;
      }
    }
    return out;
  }

  async function createLead() {
    const businessName = addForm.businessName.trim();
    if (!businessName) {
      toast.error("Business name is required");
      return;
    }
    const emails = addForm.emails
      .split(/[;,]/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    const address: LeadAddress = {};
    if (addForm.street.trim()) address.street = addForm.street.trim();
    if (addForm.city.trim()) address.city = addForm.city.trim();
    if (addForm.state.trim()) address.state = addForm.state.trim();
    if (addForm.postalCode.trim()) address.postalCode = addForm.postalCode.trim();
    if (addForm.country.trim()) address.country = addForm.country.trim();
    const customFieldsPayload = buildCustomFieldsPayload();

    setAddBusy(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          phone: addForm.phone.trim() || null,
          website: addForm.website.trim() || null,
          category: addForm.category.trim() || null,
          ownerName: addForm.ownerName.trim() || null,
          status: addForm.status,
          notes: addForm.notes.trim() || undefined,
          emails: emails.length > 0 ? emails : undefined,
          address: Object.keys(address).length > 0 ? address : undefined,
          campaignIds: addForm.campaignId ? [addForm.campaignId] : undefined,
          customFields:
            Object.keys(customFieldsPayload).length > 0
              ? customFieldsPayload
              : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        lead?: Lead;
        error?: string;
      };
      if (!res.ok || !data.lead) {
        toast.error(data.error ?? "Could not add the lead");
        return;
      }
      toast.success(`Added "${data.lead.businessName}"`);
      resetAddForm();
      setAddOpen(false);
      reload();
    } finally {
      setAddBusy(false);
    }
  }

  /** Create a custom field from the inline creator, then add it to the form. */
  async function createCustomFieldInline() {
    const key = newCf.key.trim();
    const label = newCf.label.trim();
    if (!key || !label) {
      toast.error("Key and label are required");
      return;
    }
    const options =
      newCf.type === "select"
        ? newCf.options
            .split(",")
            .map((o) => o.trim())
            .filter((o) => o.length > 0)
        : undefined;
    setAddCfBusy(true);
    try {
      const res = await fetch("/api/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, label, type: newCf.type, options }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        field?: LeadCustomField;
        error?: string;
      };
      if (!res.ok || !data.field) {
        toast.error(data.error ?? "Could not create the custom field");
        return;
      }
      setCustomFields((prev) => [...prev, data.field!]);
      setNewCf({ key: "", label: "", type: "text", options: "" });
      setAddCfOpen(false);
      toast.success(`Added custom field "${data.field.label}"`);
    } finally {
      setAddCfBusy(false);
    }
  }

  async function importLeads(
    payload: CsvImportPayload,
  ): Promise<CsvImportResult> {
    const res = await fetch("/api/leads/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      created?: number;
      skipped?: number;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "Import failed");
    // Import may have auto-created custom fields — refresh so their columns
    // appear in the picker and render on rows.
    const fieldsRes = await fetch("/api/custom-fields").catch(() => null);
    if (fieldsRes?.ok) {
      const fieldsData = (await fieldsRes.json().catch(() => ({}))) as {
        fields?: LeadCustomField[];
      };
      if (fieldsData.fields) setCustomFields(fieldsData.fields);
    }
    reload();
    return { imported: data.created ?? 0, errors: data.skipped ?? 0 };
  }

  function exportCsv() {
    const params = buildParams(false);
    params.set("columns", visibleColumns.join(","));
    window.location.href = `/api/leads/export?${params.toString()}`;
  }

  /** Drain the needs-review queue via AI rescue (up to 50 at a time). */
  async function rescueRecords() {
    setRescuing(true);
    try {
      const res = await fetch("/api/leads/rescue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        attempted?: number;
        rescued?: number;
        capReached?: boolean;
        code?: string;
        error?: string;
      };
      if (res.status === 402 || data.code === "AI_CAP_REACHED") {
        toast.error(
          data.error ??
            "You've reached your monthly AI limit — upgrade to rescue more records.",
        );
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? "Could not rescue records");
        return;
      }
      const rescued = data.rescued ?? 0;
      if (rescued > 0) {
        toast.success(
          `Rescued ${rescued} record${rescued === 1 ? "" : "s"}${
            data.capReached ? " (AI limit reached — some left for later)" : ""
          }`,
        );
      } else if (data.capReached) {
        toast.error(
          "You've reached your monthly AI limit — upgrade to rescue more records.",
        );
      } else {
        toast.info("No records could be rescued");
      }
      reload();
    } finally {
      setRescuing(false);
    }
  }

  async function saveView(name: string) {
    const res = await fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        columns: visibleColumns,
        filters: filterSpecs,
        sort: { key: sortKey, dir: sortDir },
        pageSize,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      view?: SavedViewRecord;
      error?: string;
    };
    if (!res.ok || !data.view) {
      toast.error(data.error ?? "Could not save the view");
      return;
    }
    setViews((prev) => [...prev, data.view!]);
    setActiveViewId(data.view.id);
    toast.success(`Saved view "${data.view.name}"`);
  }

  function loadView(id: string) {
    const view = views.find((v) => v.id === id);
    if (view) applyView(view);
  }

  async function setDefaultView(id: string) {
    const res = await fetch(`/api/views/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    if (!res.ok) {
      toast.error("Could not set the default view");
      return;
    }
    setViews((prev) => prev.map((v) => ({ ...v, isDefault: v.id === id })));
    toast.success("Default view set");
  }

  async function deleteView(id: string) {
    const res = await fetch(`/api/views/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not delete the view");
      return;
    }
    setViews((prev) => prev.filter((v) => v.id !== id));
    if (activeViewId === id) setActiveViewId(null);
    toast.success("View deleted");
  }

  function openDetail(lead: Lead) {
    if (detailClickTimer.current) clearTimeout(detailClickTimer.current);
    detailClickTimer.current = setTimeout(() => {
      setDetailLead(lead);
      setDetailOpen(true);
      detailClickTimer.current = null;
    }, 220);
  }

  function cancelPendingDetail() {
    if (detailClickTimer.current) {
      clearTimeout(detailClickTimer.current);
      detailClickTimer.current = null;
    }
  }

  function cellContent(lead: Lead, column: TableColumn) {
    if (column.isCustom) {
      const slug = customFieldSlug(column.key);
      const value = slug ? lead.customFields?.[slug] : undefined;
      return (
        <span className="block truncate text-sm">
          {value == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            String(value)
          )}
        </span>
      );
    }

    const key = column.key;

    if (EDITABLE_TEXT_KEYS.has(key)) {
      const raw = (lead as unknown as Record<string, unknown>)[key];
      return (
        <InlineEditCell
          value={typeof raw === "string" ? raw : ""}
          alwaysEdit={editMode}
          onSave={(next) => editCell(lead.id, { [key]: next || null })}
        />
      );
    }

    if (key === "status") {
      return (
        <InlineEditCell
          type="select"
          value={lead.status}
          alwaysEdit={editMode}
          options={LEAD_STATUSES.map((s) => ({ value: s, label: s }))}
          onSave={(next) => editCell(lead.id, { status: next })}
        />
      );
    }

    if (key === "score") {
      return (
        <span
          className="block truncate text-sm"
          title={lead.scoreReasoning ?? undefined}
        >
          {lead.score == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            lead.score
          )}
        </span>
      );
    }

    if (key === "emails") {
      const emails = lead.emails ?? [];
      return (
        <span className="block truncate text-sm">
          {emails.length > 0 ? (
            emails.join(", ")
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      );
    }

    if (key === "parseIssues") {
      return (
        <span className="block truncate text-sm">
          {lead.parseIssues.length > 0 ? (
            lead.parseIssues.join("; ")
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      );
    }

    if (key === "city") {
      return (
        <span className="block truncate text-sm">
          {lead.address?.city ?? ""}
        </span>
      );
    }
    if (key === "state") {
      return (
        <span className="block truncate text-sm">
          {lead.address?.state ?? ""}
        </span>
      );
    }

    if (column.type === "date") {
      const raw = (lead as unknown as Record<string, unknown>)[key];
      return (
        <span className="block truncate text-sm">{formatDateTime(raw)}</span>
      );
    }

    if (key === "website" && lead.website) {
      return (
        <a
          href={lead.website}
          target="_blank"
          rel="noreferrer"
          className="text-primary block truncate text-sm hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {lead.website}
        </a>
      );
    }

    const raw = (lead as unknown as Record<string, unknown>)[key];
    return (
      <span className="block truncate text-sm">
        {raw == null || raw === "" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          String(raw)
        )}
      </span>
    );
  }

  const shownColumns = visibleColumns
    .map((key) => columnByKey.get(key))
    .filter((c): c is TableColumn => Boolean(c));

  const selectedCount = allMatching ? total : selected.size;
  const allPageSelected =
    (leads?.length ?? 0) > 0 &&
    (allMatching || leads!.every((l) => selected.has(l.id)));
  const activeFilterCount =
    Object.keys(filterSpecs).length +
    (q ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (campaignId ? 1 : 0) +
    (sessionId ? 1 : 0) +
    (notEnriched ? 1 : 0) +
    (missingOfferLine ? 1 : 0);
  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search name, phone, website, notes…"
          className="h-9 max-w-xs"
          aria-label="Search leads"
        />
        <CampaignPicker
          value={campaignId}
          onChange={(id) => withReset(() => setCampaignId(id))}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
          onCreated={(campaign) => setCampaigns((prev) => [campaign, ...prev])}
          placeholder="All campaigns"
        />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SavedViewsMenu
            views={views.map((v) => ({
              id: v.id,
              name: v.name,
              isDefault: v.isDefault,
            }))}
            activeViewId={activeViewId}
            onLoad={loadView}
            onSave={(name) => void saveView(name)}
            onSetDefault={(id) => void setDefaultView(id)}
            onDelete={(id) => void deleteView(id)}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-2">
              <ColumnPicker
                columns={columns.map((c) => ({ key: c.key, label: c.label }))}
                visibleKeys={visibleColumns}
                onChange={setVisibleColumns}
              />
            </DropdownMenuContent>
          </DropdownMenu>

          {needsReviewCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void rescueRecords()}
              disabled={rescuing}
            >
              <Sparkles aria-hidden="true" />
              {rescuing ? "Rescuing…" : `Rescue ${needsReviewCount} record${needsReviewCount === 1 ? "" : "s"}`}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setJobsOpen(true)}
          >
            <Briefcase aria-hidden="true" />
            Jobs
          </Button>

          <Button
            variant={editMode ? "default" : "outline"}
            size="sm"
            aria-pressed={editMode}
            onClick={() =>
              editMode ? requestExitEditMode() : setEditMode(true)
            }
          >
            <Pencil aria-hidden="true" />
            {editMode ? "Editing…" : "Edit mode"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Upload aria-hidden="true" />
            Import
          </Button>

          {canExport ? (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              asChild
              title={`CSV export is available on ${exportPlan ?? "a paid plan"} and above`}
            >
              <Link href="/settings/billing">Export CSV</Link>
            </Button>
          )}

          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" />
            Add lead
          </Button>
        </div>
      </div>

      {/* Capture-session filter banner */}
      {sessionId && (
        <div className="bg-accent text-accent-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <Filter className="size-4" aria-hidden="true" />
          <span>Filtered by capture session</span>
          <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
            {sessionId}
          </code>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7"
            onClick={() => withReset(() => setSessionId(null))}
          >
            <X aria-hidden="true" />
            Clear
          </Button>
        </div>
      )}

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => withReset(() => setStatusFilter(""))}
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
            statusFilter === ""
              ? "bg-primary text-primary-foreground border-transparent"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          All
        </button>
        {LEAD_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => withReset(() => setStatusFilter(status))}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
              statusFilter === status
                ? "bg-primary text-primary-foreground border-transparent"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {status === "needs_review" && needsReviewCount > 0
              ? `${status} (${needsReviewCount})`
              : status}
          </button>
        ))}
        <span className="bg-border mx-1 h-4 w-px" aria-hidden="true" />

        <Link
          href="/leads/duplicates"
          className={cn(
            "flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
            "text-muted-foreground hover:bg-accent",
          )}
        >
          possible duplicates
          {duplicatesCount !== null && duplicatesCount > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0">
              {duplicatesCount}
            </Badge>
          )}
        </Link>

        <button
          type="button"
          onClick={() => withReset(() => setNotEnriched((v) => !v))}
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
            notEnriched
              ? "bg-primary text-primary-foreground border-transparent"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          not enriched
        </button>

        <button
          type="button"
          onClick={() => withReset(() => setMissingOfferLine((v) => !v))}
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
            missingOfferLine
              ? "bg-primary text-primary-foreground border-transparent"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          no offer line
        </button>

        <label className="text-muted-foreground ml-2 flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={includeJunk}
            onChange={(e) => withReset(() => setIncludeJunk(e.target.checked))}
          />
          Show junk
        </label>
        {activeFilterCount > 0 && (
          <Badge variant="secondary" className="ml-1">
            {activeFilterCount} active filter
            {activeFilterCount === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      {/* Edit-mode bar */}
      {editMode && (
        <div
          role="toolbar"
          aria-label="Edit mode"
          className="bg-primary/10 border-primary/30 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
        >
          <span className="font-medium">
            Edit mode — this page
            {dirtyCount > 0
              ? ` · ${dirtyCount} unsaved lead${dirtyCount === 1 ? "" : "s"}`
              : ""}
          </span>
          <span className="text-muted-foreground text-xs">
            AI fields (score, reasoning) stay read-only.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              disabled={savingAll || dirtyCount === 0}
              onClick={() => void saveAllEdits()}
            >
              {savingAll ? "Saving…" : "Save all"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={savingAll || dirtyCount === 0}
              onClick={discardEdits}
            >
              Discard
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={savingAll}
              onClick={requestExitEditMode}
            >
              Exit edit mode
            </Button>
          </div>
        </div>
      )}

      {/* Bulk actions */}
      <BulkActionBar
        selectedCount={selectedCount}
        totalMatching={total}
        onClear={resetSelection}
        onSelectAllMatching={() => setAllMatching(true)}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRunAiOpen(true)}
        >
          <Sparkles aria-hidden="true" />
          Run AI pass
        </Button>
        <Select
          className="h-8 w-36"
          aria-label="Set status"
          value=""
          onChange={(e) => {
            if (e.target.value)
              void runBulk({ action: "set-status", status: e.target.value });
          }}
        >
          <option value="">Set status…</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1">
          <Select
            className="h-8 w-36"
            aria-label="Add to campaign"
            value={bulkCampaignId}
            onChange={(e) => setBulkCampaignId(e.target.value)}
          >
            <option value="">Add to campaign…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!bulkCampaignId}
            onClick={() =>
              void runBulk({
                action: "add-campaign",
                campaignId: bulkCampaignId,
              }).then(() => setBulkCampaignId(""))
            }
          >
            Add
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void runBulk({ action: "mark-junk" })}
        >
          Mark junk
        </Button>
        <ConfirmDialog
          title={`Delete ${selectedCount} lead(s)?`}
          description="This can't be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={() => runBulk({ action: "delete" })}
          trigger={
            <Button variant="destructive" size="sm">
              Delete
            </Button>
          }
        />
      </BulkActionBar>

      {/* Table */}
      {leads === null ? (
        <p className="text-muted-foreground text-sm">Loading leads…</p>
      ) : leads.length === 0 ? (
        <EmptyState
          title="No leads yet"
          description="Capture businesses with the extension, import a CSV, or add one manually to get started."
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus aria-hidden="true" />
              Add lead
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allPageSelected}
                    aria-label="Select all on page"
                    onChange={(e) => togglePage(e.target.checked)}
                  />
                </TableHead>
                <TableHead className="text-muted-foreground w-10 text-right font-medium">
                  #
                </TableHead>
                {shownColumns.map((column) => {
                  const hasFilter = filterSpecs[column.key] !== undefined;
                  return (
                    <TableHead key={column.key} className="whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {column.sortable ? (
                          <SortableHeader
                            label={column.label}
                            columnKey={column.key}
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={handleSort}
                          />
                        ) : (
                          <span className="text-muted-foreground font-medium">
                            {column.label}
                          </span>
                        )}
                        {column.filterable && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Filter ${column.label}`}
                                className={cn(
                                  "rounded-sm p-0.5",
                                  hasFilter
                                    ? "text-primary"
                                    : "text-muted-foreground/50 hover:text-foreground",
                                )}
                              >
                                <Filter
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="start"
                              className="w-56 p-2"
                            >
                              <DropdownMenuLabel className="px-0">
                                Filter {column.label}
                              </DropdownMenuLabel>
                              <ColumnFilter
                                column={{
                                  key: column.key,
                                  label: column.label,
                                  type: column.filterType,
                                  enumValues: column.enumValues,
                                }}
                                value={columnFilters[column.key]}
                                onChange={(value) =>
                                  setColumnFilter(column.key, value)
                                }
                              />
                              {hasFilter && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-2 w-full"
                                  onClick={() => clearColumnFilter(column.key)}
                                >
                                  Clear
                                </Button>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead, index) => (
                <TableRow
                  key={lead.id}
                  className={cn(
                    "cursor-pointer",
                    dirty[lead.id] && "bg-primary/5",
                  )}
                  onClick={() => openDetail(lead)}
                  onDoubleClick={cancelPendingDetail}
                >
                  <TableCell
                    className="w-8"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={allMatching || selected.has(lead.id)}
                      aria-label={`Select ${lead.businessName}`}
                      onChange={(e) => toggleRow(lead.id, e.target.checked)}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground w-10 text-right text-sm tabular-nums">
                    {(page - 1) * pageSize + index + 1}
                  </TableCell>
                  {shownColumns.map((column) => (
                    <TableCell key={column.key} className="max-w-56">
                      {cellContent(lead, column)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {leads !== null && leads.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={(next) => {
            setPage(next);
            resetSelection();
          }}
          onPageSizeChange={(size) =>
            withReset(() => setPageSize(size as SavedViewPageSize))
          }
        />
      )}

      {loading && leads !== null && (
        <p className="text-muted-foreground text-xs">Refreshing…</p>
      )}

      <LeadDetailDrawer
        lead={detailLead}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdated={(updated) => {
          setLeads(
            (prev) =>
              prev?.map((l) => (l.id === updated.id ? updated : l)) ?? null,
          );
          setDetailLead(updated);
        }}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={importLeads}
        customFields={customFields.map((f) => ({ key: f.key, label: f.label }))}
      />

      <RunAiPassDialog
        open={runAiOpen}
        onOpenChange={setRunAiOpen}
        selectedCount={selectedCount}
        getSelection={getJobSelection}
        onLaunched={() => setJobsOpen(true)}
      />

      <DetailDrawer
        open={jobsOpen}
        onOpenChange={setJobsOpen}
        title="Jobs"
      >
        <JobsPanel open={jobsOpen} />
      </DetailDrawer>

      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          if (addBusy) return;
          if (!next) resetAddForm();
          setAddOpen(next);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add lead</DialogTitle>
            <DialogDescription>
              Manually add a business to the Lead Directory.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-business">Business name *</Label>
              <Input
                id="add-business"
                value={addForm.businessName}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, businessName: e.target.value }))
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-status">Status</Label>
                <Select
                  id="add-status"
                  value={addForm.status}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      status: e.target.value as LeadStatus,
                    }))
                  }
                >
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-category">Category</Label>
                <Input
                  id="add-category"
                  value={addForm.category}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, category: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-phone">Phone</Label>
                <Input
                  id="add-phone"
                  value={addForm.phone}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, phone: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-website">Website</Label>
                <Input
                  id="add-website"
                  value={addForm.website}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, website: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-owner">Owner name</Label>
                <Input
                  id="add-owner"
                  value={addForm.ownerName}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, ownerName: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-campaign">Campaign</Label>
                <Select
                  id="add-campaign"
                  value={addForm.campaignId}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, campaignId: e.target.value }))
                  }
                >
                  <option value="">No campaign</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-emails">Emails</Label>
              <Input
                id="add-emails"
                value={addForm.emails}
                placeholder="jane@acme.com, info@acme.com"
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, emails: e.target.value }))
                }
              />
              <p className="text-muted-foreground text-xs">
                Comma-separated.
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-md border p-3">
              <p className="text-sm font-medium">Address</p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-street">Street</Label>
                <Input
                  id="add-street"
                  value={addForm.street}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, street: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="add-city">City</Label>
                  <Input
                    id="add-city"
                    value={addForm.city}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, city: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="add-state">State</Label>
                  <Input
                    id="add-state"
                    value={addForm.state}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, state: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="add-postal">Postal code</Label>
                  <Input
                    id="add-postal"
                    value={addForm.postalCode}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, postalCode: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="add-country">Country</Label>
                  <Input
                    id="add-country"
                    value={addForm.country}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, country: e.target.value }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-notes">Notes</Label>
              <Textarea
                id="add-notes"
                value={addForm.notes}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>

            {/* Custom fields */}
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Custom fields</p>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setAddCfOpen((v) => !v)}
                >
                  <Plus aria-hidden="true" />
                  Add custom field
                </Button>
              </div>

              {customFields.length === 0 && !addCfOpen && (
                <p className="text-muted-foreground text-xs">
                  No custom fields yet.
                </p>
              )}

              {customFields.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {customFields.map((field) => {
                    const value = addCustomValues[field.key] ?? "";
                    const setValue = (next: string) =>
                      setAddCustomValues((prev) => ({
                        ...prev,
                        [field.key]: next,
                      }));
                    return (
                      <div key={field.id} className="flex flex-col gap-1.5">
                        <Label htmlFor={`add-cf-${field.key}`}>
                          {field.label}
                        </Label>
                        {field.type === "select" ? (
                          <Select
                            id={`add-cf-${field.key}`}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                          >
                            <option value="">—</option>
                            {field.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </Select>
                        ) : field.type === "boolean" ? (
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              id={`add-cf-${field.key}`}
                              checked={value === "true"}
                              onChange={(e) =>
                                setValue(e.target.checked ? "true" : "")
                              }
                            />
                            Yes
                          </label>
                        ) : (
                          <Input
                            id={`add-cf-${field.key}`}
                            type={
                              field.type === "number"
                                ? "number"
                                : field.type === "date"
                                  ? "date"
                                  : "text"
                            }
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {addCfOpen && (
                <div className="bg-muted/40 flex flex-col gap-3 rounded-md border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="new-cf-label">Label</Label>
                      <Input
                        id="new-cf-label"
                        value={newCf.label}
                        placeholder="Priority"
                        onChange={(e) =>
                          setNewCf((f) => ({ ...f, label: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="new-cf-key">Key</Label>
                      <Input
                        id="new-cf-key"
                        value={newCf.key}
                        placeholder="priority"
                        onChange={(e) =>
                          setNewCf((f) => ({ ...f, key: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="new-cf-type">Type</Label>
                      <Select
                        id="new-cf-type"
                        value={newCf.type}
                        onChange={(e) =>
                          setNewCf((f) => ({
                            ...f,
                            type: e.target.value as CustomFieldType,
                          }))
                        }
                      >
                        {CUSTOM_FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div
                      className={cn(
                        "flex flex-col gap-1.5",
                        newCf.type !== "select" && "opacity-50",
                      )}
                    >
                      <Label htmlFor="new-cf-options">Options</Label>
                      <Input
                        id="new-cf-options"
                        value={newCf.options}
                        placeholder="Low, Medium, High"
                        disabled={newCf.type !== "select"}
                        onChange={(e) =>
                          setNewCf((f) => ({ ...f, options: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      type="button"
                      disabled={addCfBusy}
                      onClick={() => void createCustomFieldInline()}
                    >
                      {addCfBusy ? "Adding…" : "Create field"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={addCfBusy}
                      onClick={() => setAddCfOpen(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                resetAddForm();
                setAddOpen(false);
              }}
              disabled={addBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void createLead()}
              disabled={addBusy || addForm.businessName.trim().length === 0}
            >
              {addBusy ? "Adding…" : "Add lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exit edit mode with unsaved changes */}
      <Dialog
        open={exitConfirmOpen}
        onOpenChange={(next) => {
          if (!savingAll) setExitConfirmOpen(next);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard unsaved edits?</DialogTitle>
            <DialogDescription>
              You have {dirtyCount} lead{dirtyCount === 1 ? "" : "s"} with
              unsaved changes. Leaving edit mode will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExitConfirmOpen(false)}
            >
              Keep editing
            </Button>
            <Button variant="destructive" onClick={confirmExitDiscard}>
              Discard &amp; exit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
