import { cn } from "@/lib/utils";

/**
 * Global row-number for a `#` column. The number is stable across pages:
 * `(page - 1) * pageSize + index + 1`. For an unpaginated list, leave `page`
 * at 1 and `pageSize` at 0 (the default) so it collapses to `index + 1`.
 */
export function rowNumber(index: number, page = 1, pageSize = 0): number {
  return (page - 1) * pageSize + index + 1;
}

interface RowNumberCellProps {
  /** 0-based position within the current page's rendered rows. */
  index: number;
  /** 1-based current page (default 1 for unpaginated lists). */
  page?: number;
  /** Rows per page (default 0 for unpaginated lists). */
  pageSize?: number;
  className?: string;
}

/**
 * Muted, right-aligned cell rendering the global row number for a `#` column.
 * Pair with a `#` header. Used across the leads/admin tables (§7) so numbering
 * is consistent and offset-aware wherever pagination exists.
 */
export function RowNumberCell({
  index,
  page = 1,
  pageSize = 0,
  className,
}: RowNumberCellProps) {
  return (
    <span
      className={cn("text-muted-foreground tabular-nums text-sm", className)}
    >
      {rowNumber(index, page, pageSize)}
    </span>
  );
}
