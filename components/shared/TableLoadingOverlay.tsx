"use client";

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface TableLoadingOverlayProps {
  /** When true, the overlay fades in over the table area. */
  show: boolean;
  className?: string;
}

/** Semi-transparent spinner overlay for in-place table refetches. */
export function TableLoadingOverlay({ show, className }: TableLoadingOverlayProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-20 flex items-center justify-center",
        "bg-background/55 backdrop-blur-[1px] transition-opacity duration-300 ease-out",
        show ? "opacity-100" : "opacity-0",
        className,
      )}
      aria-hidden={!show}
      aria-busy={show}
    >
      <Loader2
        className="text-primary size-7 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
