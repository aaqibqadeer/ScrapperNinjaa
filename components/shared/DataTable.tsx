import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DataTableColumn<T> {
  /** Stable key for the column. */
  key: string;
  header: ReactNode;
  /** `index` is the 0-based position within the rendered `rows` (for a `#`
   * column — see `RowNumberCell`). */
  cell: (row: T, index: number) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Rendered when `rows` is empty (defaults to a simple EmptyState). */
  empty?: ReactNode;
  /** When set, rows become clickable (cursor + hover); cells that shouldn't
   * trigger it (links, buttons) must `stopPropagation` themselves. */
  onRowClick?: (row: T, index: number) => void;
}

/**
 * Thin, generic table over the `Table` primitive (Phase 7, §9). Columns declare
 * a header + a `cell` renderer (which can return actions/badges), so admin lists
 * reuse one table instead of hand-rolling `<table>` each time.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  empty,
  onRowClick,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="Nothing here yet." />}</>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow
            key={getRowKey(row)}
            className={onRowClick ? "cursor-pointer" : undefined}
            onClick={onRowClick ? () => onRowClick(row, index) : undefined}
          >
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.cell(row, index)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
