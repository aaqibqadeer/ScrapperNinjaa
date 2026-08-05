"use client";

import { useEffect, useState } from "react";

import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format/datetime";
import type { CaptureSession } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

export interface SessionOption {
  id: string;
  label: string;
}

export interface SessionPickerProps {
  value: string | null;
  onChange: (sessionId: string | null) => void;
  placeholder?: string;
  className?: string;
}

function sessionLabel(session: CaptureSession, campaignName?: string): string {
  const when = formatDateTime(session.startedAt);
  const campaign = campaignName ? ` · ${campaignName}` : "";
  return `${when}${campaign} (${session.capturedCount})`;
}

/**
 * Filter leads by capture session. Loads recent sessions from
 * `GET /api/capture-sessions` and labels each row with start time + count.
 */
export function SessionPicker({
  value,
  onChange,
  placeholder = "All sessions",
  className,
}: SessionPickerProps) {
  const [sessions, setSessions] = useState<CaptureSession[]>([]);
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
        const data = (await sessionsRes.json()) as {
          sessions?: CaptureSession[];
        };
        setSessions(data.sessions ?? []);
      }
      if (campaignsRes?.ok) {
        const data = (await campaignsRes.json()) as {
          campaigns?: { id: string; name: string }[];
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

  return (
    <Select
      className={cn("h-8 w-52", className)}
      aria-label="Capture session"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? e.target.value : null)}
    >
      <option value="">{placeholder}</option>
      {sessions.map((session) => (
        <option key={session.id} value={session.id}>
          {sessionLabel(session, campaignNames.get(session.campaignId))}
        </option>
      ))}
    </Select>
  );
}
