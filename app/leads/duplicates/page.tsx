import type { Metadata } from "next";
import Link from "next/link";

import { DuplicateReview } from "@/components/leads/DuplicateReview";
import { AppShell } from "@/components/shared/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Duplicate Review" };

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const session = await requireAuth();

  if (!features.scraper.enabled) {
    return (
    <AppShell session={session}>
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
          <EmptyState
            title="Duplicate review is not enabled"
            description="The lead-scraping product is turned off for this workspace."
          />
        </main>
      </AppShell>
  );
  }

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold">
              Duplicate Review
            </h1>
            <p className="text-muted-foreground text-sm">
              Merge likely-duplicate businesses, or keep both. Pick which
              value survives for each field.
            </p>
          </div>
          <Link
            href="/leads"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Back to leads
          </Link>
        </div>

        <DuplicateReview />
      </main>
    </AppShell>
  );
}
