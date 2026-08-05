"use client";

import { cn } from "@/lib/utils";

export interface TableLoadingSkeletonProps {
  rows?: number;
  className?: string;
}

/** Pulsing placeholder rows for the first table load. */
export function TableLoadingSkeleton({
  rows = 6,
  className,
}: TableLoadingSkeletonProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 rounded-md border p-3",
        className,
      )}
      aria-busy="true"
      aria-label="Loading table"
    >
      <div className="bg-muted/60 h-9 w-full max-w-md animate-pulse rounded-md" />
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="bg-muted/40 h-10 w-full animate-pulse rounded-md"
        />
      ))}
    </div>
  );
}
