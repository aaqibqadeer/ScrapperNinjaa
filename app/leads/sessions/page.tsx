import type { Metadata } from "next";
import Link from "next/link";

import { CaptureSessionsTable } from "@/components/leads/CaptureSessionsTable";
import { AppShell } from "@/components/shared/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Capture Sessions" };

export const dynamic = "force-dynamic";

export default async function CaptureSessionsPage() {
  const session = await requireAuth();

  if (!features.scraper.enabled) {
    return (
    <AppShell session={session}>
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
          <EmptyState
            title="Capture sessions are not enabled"
            description="The lead-scraping product is turned off for this workspace."
          />
        </main>
      </AppShell>
  );
  }

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold">
              Capture Sessions
            </h1>
            <p className="text-muted-foreground text-sm">
              Every extension capture run — when, where, how many, and its
              status.
            </p>
          </div>
          <Link
            href="/leads"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Back to leads
          </Link>
        </div>

        <CaptureSessionsTable />
      </main>
    </AppShell>
  );
}
