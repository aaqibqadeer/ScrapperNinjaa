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

type LeadsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toInitialSearch(
  raw: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }
  return params.toString();
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const session = await requireAuth();
  const initialSearch = toInitialSearch(await searchParams);

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
        <LeadsTable
          canExport={canExport}
          exportPlan={exportPlan}
          initialSearch={initialSearch}
        />
      </main>
    </AppShell>
  );
}
