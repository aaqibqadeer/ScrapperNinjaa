"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableLoadingSkeleton } from "@/components/shared/TableLoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldType,
  type LeadCustomField,
} from "@/lib/db/schema";
import {
  cachedJsonFetch,
  invalidateFetchCache,
  peekFetchCache,
} from "@/lib/client/fetch-cache";
import { cn } from "@/lib/utils";

interface CreateFormState {
  key: string;
  label: string;
  type: CustomFieldType;
  options: string;
}

const EMPTY_FORM: CreateFormState = {
  key: "",
  label: "",
  type: "text",
  options: "",
};

/**
 * CRUD for the org's lead custom-field definitions (§14/§9). Lists existing
 * fields, offers a create form (key, label, type, and comma-separated options
 * for `select`), and deletes with a confirm. All writes hit `/api/custom-fields`.
 */
export function CustomFieldManager() {
  const [fields, setFields] = useState<LeadCustomField[] | null>(null);
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function load() {
    const cached = peekFetchCache<{ fields: LeadCustomField[] }>(
      "/api/custom-fields",
    );
    if (cached) {
      setFields(cached.fields);
      return;
    }
    const result = await cachedJsonFetch<{ fields: LeadCustomField[] }>(
      "/api/custom-fields",
    );
    if (result.ok) {
      setFields(result.data.fields);
    } else {
      setFields([]);
      toast.error("Could not load custom fields");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate() {
    const key = form.key.trim();
    const label = form.label.trim();
    if (!key || !label) {
      toast.error("Key and label are required");
      return;
    }
    const options =
      form.type === "select"
        ? form.options
            .split(",")
            .map((o) => o.trim())
            .filter((o) => o.length > 0)
        : undefined;
    setBusy(true);
    try {
      const res = await fetch("/api/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, label, type: form.type, options }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        field?: LeadCustomField;
        error?: string;
      };
      if (!res.ok || !data.field) {
        toast.error(data.error ?? "Could not create the custom field");
        return;
      }
      setFields((prev) => [...(prev ?? []), data.field!]);
      invalidateFetchCache("/api/custom-fields");
      setForm(EMPTY_FORM);
      toast.success(`Added custom field "${data.field.label}"`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "Could not delete the custom field");
      return;
    }
    setFields((prev) => prev?.filter((f) => f.id !== id) ?? null);
    invalidateFetchCache("/api/custom-fields");
    toast.success("Custom field deleted");
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Custom fields</h2>
        {fields === null ? (
          <TableLoadingSkeleton rows={4} />
        ) : fields.length === 0 ? (
          <EmptyState
            title="No custom fields yet"
            description="Add your own columns (e.g. a status tag or a numeric score) to capture extra data on every lead."
          />
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {fields.map((field) => (
              <li
                key={field.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="font-medium">{field.label}</span>
                <code className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">
                  {field.key}
                </code>
                <span className="text-muted-foreground text-xs">
                  {field.type}
                </span>
                {field.type === "select" && field.options.length > 0 && (
                  <span className="text-muted-foreground truncate text-xs">
                    ({field.options.join(", ")})
                  </span>
                )}
                <ConfirmDialog
                  title={`Delete "${field.label}"?`}
                  description="The column disappears from the Lead Directory. Values already stored on leads are left untouched."
                  confirmLabel="Delete"
                  destructive
                  onConfirm={() => handleDelete(field.id)}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto"
                      aria-label={`Delete ${field.label}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Add a custom field</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cf-label">Label</Label>
            <Input
              id="cf-label"
              value={form.label}
              placeholder="Priority"
              onChange={(e) =>
                setForm((f) => ({ ...f, label: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cf-key">Key</Label>
            <Input
              id="cf-key"
              value={form.key}
              placeholder="priority"
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
            />
            <p className="text-muted-foreground text-xs">
              Letters, digits, and underscores only.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cf-type">Type</Label>
            <Select
              id="cf-type"
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({
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
              form.type !== "select" && "opacity-50",
            )}
          >
            <Label htmlFor="cf-options">Options</Label>
            <Input
              id="cf-options"
              value={form.options}
              placeholder="Low, Medium, High"
              disabled={form.type !== "select"}
              onChange={(e) =>
                setForm((f) => ({ ...f, options: e.target.value }))
              }
            />
            <p className="text-muted-foreground text-xs">
              Comma-separated choices for a select field.
            </p>
          </div>
        </div>
        <div>
          <Button onClick={() => void handleCreate()} disabled={busy}>
            {busy ? "Adding…" : "Add field"}
          </Button>
        </div>
      </section>
    </div>
  );
}
