"use client";

import { useEffect, useState } from "react";

import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format/datetime";
import type { CaptureSession } from "@/lib/db/schema";
import { cachedJsonFetch, peekFetchCache } from "@/lib/client/fetch-cache";
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
    const sessionsUrl = "/api/capture-sessions";
    const campaignsUrl = "/api/campaigns";
    const cachedSessions = peekFetchCache<{ sessions?: CaptureSession[] }>(
      sessionsUrl,
    );
    const cachedCampaigns = peekFetchCache<{
      campaigns?: { id: string; name: string }[];
    }>(campaignsUrl);
    if (cachedSessions) setSessions(cachedSessions.sessions ?? []);
    if (cachedCampaigns) {
      setCampaignNames(
        new Map((cachedCampaigns.campaigns ?? []).map((c) => [c.id, c.name])),
      );
    }
    if (cachedSessions && cachedCampaigns) return;

    void (async () => {
      const [sessionsRes, campaignsRes] = await Promise.all([
        cachedSessions
          ? Promise.resolve(null)
          : cachedJsonFetch<{ sessions?: CaptureSession[] }>(sessionsUrl),
        cachedCampaigns
          ? Promise.resolve(null)
          : cachedJsonFetch<{ campaigns?: { id: string; name: string }[] }>(
              campaignsUrl,
            ).catch(() => null),
      ]);
      if (cancelled) return;
      if (sessionsRes?.ok) {
        setSessions(sessionsRes.data.sessions ?? []);
      }
      if (campaignsRes?.ok) {
        setCampaignNames(
          new Map(
            (campaignsRes.data.campaigns ?? []).map((c) => [c.id, c.name]),
          ),
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
