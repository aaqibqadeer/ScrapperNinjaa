import type { Metadata } from "next";

import { CustomFieldManager } from "@/components/leads/CustomFieldManager";
import { AppShell } from "@/components/shared/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Lead settings" };

export const dynamic = "force-dynamic";

export default async function LeadSettingsPage() {
  const session = await requireAuth();

  if (!features.scraper.enabled) {
    return (
    <AppShell session={session}>
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
          <EmptyState
            title="Lead settings are not enabled"
            description="The lead-scraping product is turned off for this workspace."
          />
        </main>
      </AppShell>
  );
  }

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold">Lead settings</h1>
          <p className="text-muted-foreground text-sm">
            Define custom fields to capture extra data as columns in the Lead
            Directory.
          </p>
        </div>
        <CustomFieldManager />
      </main>
    </AppShell>
  );
}
