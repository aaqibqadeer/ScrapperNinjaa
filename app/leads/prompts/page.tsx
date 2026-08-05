import type { Metadata } from "next";
import Link from "next/link";

import { OfferPromptsManager } from "@/components/leads/OfferPromptsManager";
import { AppShell } from "@/components/shared/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Offer Prompts" };

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const session = await requireAuth();

  if (!features.scraper.enabled) {
    return (
    <AppShell session={session}>
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
          <EmptyState
            title="Offer prompts are not enabled"
            description="The lead-scraping product is turned off for this workspace."
          />
        </main>
      </AppShell>
  );
  }

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold">
              Offer Prompts
            </h1>
            <p className="text-muted-foreground text-sm">
              Reusable templates for the offer-line AI pass. Edit and preview
              against a real lead before running.
            </p>
          </div>
          <Link
            href="/leads"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Back to leads
          </Link>
        </div>

        <OfferPromptsManager />
      </main>
    </AppShell>
  );
}
