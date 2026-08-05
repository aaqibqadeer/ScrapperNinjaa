"use client";

import { useState } from "react";

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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** Lead fields a CSV column can map to (in the Lead Directory). */
export const LEAD_IMPORT_FIELDS = [
  "businessName",
  "phone",
  "website",
  "category",
  "city",
  "state",
  "ownerName",
  "notes",
  "status",
] as const;

export type LeadImportField = (typeof LEAD_IMPORT_FIELDS)[number];

/** Sentinel mapping value: create a new text custom field from the header. */
export const NEW_CUSTOM_FIELD_VALUE = "__new__";
/** Prefix marking a mapping target that is an existing custom field. */
const CUSTOM_FIELD_MAP_PREFIX = "customFields.";

export interface CsvImportResult {
  imported: number;
  errors: number;
}

export interface CsvImportPayload {
  /**
   * CSV header → target. A target is a standard lead field, an existing custom
   * field (`customFields.<key>`), or `__new__` to auto-create a text field.
   */
  mapping: Record<string, string>;
  /** Parsed rows, keyed by CSV header. */
  rows: Record<string, string>[];
  /** When true, unmapped headers become new text custom fields on import. */
  autoCreateFields?: boolean;
}

export interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (payload: CsvImportPayload) => Promise<CsvImportResult>;
  /** The org's existing custom fields, offered as extra mapping targets. */
  customFields?: { key: string; label: string }[];
}

interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Minimal CSV parser: handles quoted fields (with embedded commas, newlines,
 * and doubled "" escapes). Intentionally basic — enough for lead exports.
 */
function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  const normalized = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter(
    (r) => r.length > 1 || (r[0] ?? "").trim().length > 0,
  );
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = (cells[idx] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

/** Guess a lead field from a header name (loose, case-insensitive). */
function guessField(header: string): string {
  const normalized = header.toLowerCase().replace(/[^a-z]/g, "");
  const match = LEAD_IMPORT_FIELDS.find(
    (field) => field.toLowerCase() === normalized,
  );
  if (match) return match;
  if (normalized.includes("business") || normalized.includes("company"))
    return "businessName";
  if (normalized.includes("owner")) return "ownerName";
  if (normalized.includes("phone") || normalized.includes("tel"))
    return "phone";
  if (normalized.includes("site") || normalized.includes("url"))
    return "website";
  return "";
}

/**
 * Guided CSV importer: pick a file → parse client-side → preview headers and
 * map each to a lead field → import → summary. The caller's `onImport` does the
 * server write and returns how many rows imported / errored.
 */
export function CsvImportDialog({
  open,
  onOpenChange,
  onImport,
  customFields = [],
}: CsvImportDialogProps) {
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoCreate, setAutoCreate] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);

  function reset() {
    setParsed(null);
    setMapping({});
    setFileName("");
    setError(null);
    setBusy(false);
    setAutoCreate(false);
    setResult(null);
  }

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const next = parseCsv(text);
      if (next.headers.length === 0) {
        setError("Could not find any columns in that file.");
        setParsed(null);
        return;
      }
      setParsed(next);
      const guessed: Record<string, string> = {};
      next.headers.forEach((header) => {
        const field = guessField(header);
        if (field) guessed[header] = field;
      });
      setMapping(guessed);
    } catch {
      setError("Could not read that file.");
      setParsed(null);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    const activeMapping: Record<string, string> = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field) activeMapping[header] = field;
    }
    // With auto-create on, any header the user didn't map becomes a new text
    // custom field so no CSV column is silently dropped.
    if (autoCreate) {
      for (const header of parsed.headers) {
        if (!activeMapping[header]) activeMapping[header] = NEW_CUSTOM_FIELD_VALUE;
      }
    }
    if (Object.keys(activeMapping).length === 0) {
      setError("Map at least one column to a lead field.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await onImport({
        mapping: activeMapping,
        rows: parsed.rows,
        autoCreateFields: autoCreate,
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message ?? "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Pick a CSV file, map its columns to lead fields, then import.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Import complete.</p>
            <p>
              <span className="text-foreground font-medium">
                {result.imported}
              </span>{" "}
              imported
              {result.errors > 0 && (
                <>
                  {" · "}
                  <span className="text-destructive font-medium">
                    {result.errors}
                  </span>{" "}
                  skipped
                </>
              )}
              .
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="csv-file">
                CSV file
              </label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              {fileName && (
                <p className="text-muted-foreground text-xs">{fileName}</p>
              )}
            </div>

            {parsed && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">
                  Map columns ({parsed.rows.length} rows)
                </p>
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          CSV column
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Sample
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Lead field
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.headers.map((header) => (
                        <tr key={header} className="border-t">
                          <td className="px-3 py-2 font-medium">{header}</td>
                          <td className="text-muted-foreground max-w-40 truncate px-3 py-2">
                            {parsed.rows[0]?.[header] ?? ""}
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              className="h-8"
                              value={mapping[header] ?? ""}
                              aria-label={`Map ${header}`}
                              onChange={(e) =>
                                setMapping((prev) => ({
                                  ...prev,
                                  [header]: e.target.value,
                                }))
                              }
                            >
                              <option value="">— Skip —</option>
                              <optgroup label="Standard fields">
                                {LEAD_IMPORT_FIELDS.map((field) => (
                                  <option key={field} value={field}>
                                    {field}
                                  </option>
                                ))}
                              </optgroup>
                              {customFields.length > 0 && (
                                <optgroup label="Custom fields">
                                  {customFields.map((field) => (
                                    <option
                                      key={field.key}
                                      value={`${CUSTOM_FIELD_MAP_PREFIX}${field.key}`}
                                    >
                                      {field.label}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <option value={NEW_CUSTOM_FIELD_VALUE}>
                                + New custom field…
                              </option>
                            </Select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={autoCreate}
                    onChange={(e) => setAutoCreate(e.target.checked)}
                  />
                  Create custom fields for unmapped columns
                </label>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <DialogFooter>
          {result ? (
            <Button
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={busy || !parsed}
              >
                {busy ? "Importing…" : "Import"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
