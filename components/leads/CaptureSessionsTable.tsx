"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { RowNumberCell } from "@/components/shared/RowNumberCell";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format/datetime";
import type {
  Campaign,
  CaptureSession,
  CaptureSessionStatus,
} from "@/lib/db/schema";

const STATUS_VARIANT: Record<
  CaptureSessionStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  running: "default",
  completed: "secondary",
  stopped: "outline",
  failed: "destructive",
  canceled: "outline",
};

/**
 * Capture-session history for the org. Each row is one extension capture run
 * (`GET /api/capture-sessions`), newest first. Clicking a row drills into that
 * run's leads (`/leads?sessionId=…`). Campaign names come from a client fetch
 * of `/api/campaigns`.
 */
export function CaptureSessionsTable() {
  const router = useRouter();
  const [sessions, setSessions] = useState<CaptureSession[] | null>(null);
  const [campaignNames, setCampaignNames] = useState<Map<string, string>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [sessionsRes, campaignsRes] = await Promise.all([
        fetch("/api/capture-sessions"),
        fetch("/api/campaigns").catch(() => null),
      ]);
      if (cancelled) return;
      if (sessionsRes.ok) {
        const data = (await sessionsRes.json().catch(() => ({}))) as {
          sessions?: CaptureSession[];
        };
        setSessions(data.sessions ?? []);
      } else {
        const data = (await sessionsRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setSessions([]);
        toast.error(data.error ?? "Could not load capture sessions");
      }
      if (campaignsRes?.ok) {
        const data = (await campaignsRes.json().catch(() => ({}))) as {
          campaigns?: Campaign[];
        };
        setCampaignNames(
          new Map((data.campaigns ?? []).map((c) => [c.id, c.name])),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const columns: DataTableColumn<CaptureSession>[] = [
    {
      key: "num",
      header: "#",
      className: "w-10 text-right",
      cell: (_s, index) => <RowNumberCell index={index} />,
    },
    {
      key: "startedAt",
      header: "Started",
      cell: (s) => (
        <span className="whitespace-nowrap">{formatDateTime(s.startedAt)}</span>
      ),
    },
    {
      key: "campaign",
      header: "Campaign",
      cell: (s) =>
        campaignNames.get(s.campaignId) ?? (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "sourceType", header: "Source", cell: (s) => s.sourceType },
    {
      key: "sourceUrl",
      header: "URL",
      cell: (s) =>
        s.sourceUrl ? (
          <a
            href={s.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary block max-w-56 truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {s.sourceUrl}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "mode", header: "Mode", cell: (s) => s.mode },
    {
      key: "capturedCount",
      header: "Captured",
      className: "text-right",
      cell: (s) => s.capturedCount,
    },
    {
      key: "needsReviewCount",
      header: "Needs review",
      className: "text-right",
      cell: (s) =>
        s.needsReviewCount > 0 ? (
          <span className="text-destructive font-medium">
            {s.needsReviewCount}
          </span>
        ) : (
          s.needsReviewCount
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (s) => <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>,
    },
    {
      key: "endedAt",
      header: "Ended",
      cell: (s) => (
        <span className="whitespace-nowrap">{formatDateTime(s.endedAt)}</span>
      ),
    },
  ];

  if (sessions === null) {
    return (
      <p className="text-muted-foreground text-sm">Loading capture sessions…</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <DataTable
        rows={sessions}
        getRowKey={(s) => s.id}
        columns={columns}
        onRowClick={(s) => router.push(`/leads?sessionId=${s.id}`)}
        empty={
          <EmptyState
            title="No capture sessions yet"
            description="Start a capture from the browser extension and each run will appear here."
          />
        }
      />
    </div>
  );
}
