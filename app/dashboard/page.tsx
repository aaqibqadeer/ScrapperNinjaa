import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";
import { ApplicationsTable } from "@/components/dashboard/ApplicationsTable";
import { AppShell } from "@/components/shared/AppShell";
import { Button } from "@/components/ui/button";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import {
  hasAccess,
  lowestPlanWith,
  PLAN_FEATURES,
} from "@/lib/payments/access";

export const metadata: Metadata = { title: "Dashboard" };

// Per-user page (reads the session cookie) — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // The dashboard is the applications tracker — a job-applications surface. On a
  // scraper-only fork, send users to the leads home instead (or 404 when the
  // scraper product is off too).
  if (!features.jobApplications) {
    if (features.scraper.enabled) redirect("/leads");
    notFound();
  }
  const session = await requireAuth();
  const profiles = await db.listProfilesForUser(session.user.id);
  const canExport = await hasAccess(session, PLAN_FEATURES.dataExport);
  const exportPlan = canExport
    ? null
    : ((await lowestPlanWith(PLAN_FEATURES.dataExport))?.name ?? null);

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {!session.user.emailVerified && <VerifyEmailBanner />}

        {profiles.length === 0 && (
          <div className="border-border bg-card mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Finish setting up</p>
              <p className="text-muted-foreground text-xs">
                Upload your resume to create your first profile — the
                extension can&apos;t autofill without one.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/onboarding">Start setup</Link>
            </Button>
          </div>
        )}

        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold">Applications</h1>
          <p className="text-muted-foreground text-sm">
            Everything you&apos;ve tracked — click any cell to edit it.
          </p>
        </div>

        <ApplicationsTable canExport={canExport} exportPlan={exportPlan} />
      </main>
    </AppShell>
  );
}
