import type { Metadata } from "next";

import { LeadsTable } from "@/components/leads/LeadsTable";
import { AppShell } from "@/components/shared/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";
import {
  hasAccess,
  lowestPlanWith,
  PLAN_FEATURES,
} from "@/lib/payments/access";

export const metadata: Metadata = { title: "Lead Directory" };

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const session = await requireAuth();

  if (!features.scraper.enabled) {
    return (
      <AppShell session={session}>
        <main className="mx-auto w-full max-w-3xl flex-1 overflow-auto px-6 py-10">
          <EmptyState
            title="Lead Directory is not enabled"
            description="The lead-scraping product is turned off for this workspace."
          />
        </main>
      </AppShell>
    );
  }

  const canExport = await hasAccess(session, PLAN_FEATURES.dataExport);
  const exportPlan = canExport
    ? null
    : ((await lowestPlanWith(PLAN_FEATURES.dataExport))?.name ?? null);

  return (
    <AppShell session={session}>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <LeadsTable canExport={canExport} exportPlan={exportPlan} />
      </main>
    </AppShell>
  );
}
