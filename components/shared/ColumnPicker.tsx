"use client";

import { useState } from "react";
import { GripVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface ColumnPickerColumn {
  key: string;
  label: string;
}

export interface ColumnPickerProps {
  columns: ColumnPickerColumn[];
  /** Ordered list of currently-visible column keys. */
  visibleKeys: string[];
  /** Called with the next ordered list of visible keys. */
  onChange: (visibleKeysOrdered: string[]) => void;
  className?: string;
}

/**
 * Show/hide + reorder columns. Visible columns are drag-reorderable via native
 * HTML5 drag-and-drop (no dnd library); hidden columns are listed separately
 * and re-added to the end of the visible list when re-checked.
 */
export function ColumnPicker({
  columns,
  visibleKeys,
  onChange,
  className,
}: ColumnPickerProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);

  const byKey = new Map(columns.map((c) => [c.key, c]));
  const visible = visibleKeys
    .map((key) => byKey.get(key))
    .filter((c): c is ColumnPickerColumn => Boolean(c));
  const hidden = columns.filter((c) => !visibleKeys.includes(c.key));

  function hide(key: string) {
    onChange(visibleKeys.filter((k) => k !== key));
  }

  function show(key: string) {
    onChange([...visibleKeys, key]);
  }

  function handleDrop(targetKey: string) {
    if (dragKey === null || dragKey === targetKey) {
      setDragKey(null);
      return;
    }
    const next = visibleKeys.filter((k) => k !== dragKey);
    const targetIndex = next.indexOf(targetKey);
    next.splice(targetIndex, 0, dragKey);
    onChange(next);
    setDragKey(null);
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(columns.map((c) => c.key))}
        >
          Select all
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([])}
        >
          Select none
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs font-medium">
          Visible columns
        </p>
        <ul className="flex flex-col gap-1">
          {visible.map((column) => (
            <li
              key={column.key}
              draggable
              onDragStart={() => setDragKey(column.key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(column.key)}
              onDragEnd={() => setDragKey(null)}
              className={cn(
                "bg-background flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
                dragKey === column.key && "opacity-50",
              )}
            >
              <GripVertical
                className="text-muted-foreground size-4 shrink-0 cursor-grab"
                aria-hidden="true"
              />
              <Checkbox
                checked
                aria-label={`Hide ${column.label}`}
                onChange={() => hide(column.key)}
              />
              <span className="flex-1 truncate">{column.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {hidden.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs font-medium">
            Hidden columns
          </p>
          <ul className="flex flex-col gap-1">
            {hidden.map((column) => (
              <li
                key={column.key}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              >
                <span className="size-4 shrink-0" aria-hidden="true" />
                <Checkbox
                  checked={false}
                  aria-label={`Show ${column.label}`}
                  onChange={() => show(column.key)}
                />
                <span className="text-muted-foreground flex-1 truncate">
                  {column.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
