import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GmailScanPanel } from "@/components/gmail/GmailScanPanel";
import { AppShell } from "@/components/shared/AppShell";
import { UpgradeNotice } from "@/components/shared/UpgradeNotice";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";
import {
  hasAccess,
  lowestPlanWith,
  PLAN_FEATURES,
} from "@/lib/payments/access";

export const metadata: Metadata = { title: "Gmail scan" };

export const dynamic = "force-dynamic";

export default async function GmailSettingsPage() {
  if (!features.jobApplications || !features.gmail) notFound();
  const session = await requireAuth();
  const unlocked = await hasAccess(session, PLAN_FEATURES.gmailScan);
  const requiredPlan = unlocked
    ? null
    : ((await lowestPlanWith(PLAN_FEATURES.gmailScan))?.name ?? null);

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold">Gmail scan</h1>
          <p className="text-muted-foreground text-sm">
            Scan your inbox for interview invites, rejections, offers, and
            assessments — then approve which tracked applications to update.
          </p>
        </div>
        {unlocked ? (
          <GmailScanPanel />
        ) : (
          <UpgradeNotice
            title="Gmail scanning is a paid feature"
            description="Connect Gmail to have ApplyNinjaa read your inbox for interview invites, rejections, offers, and assessments, then propose status updates for you to approve."
            requiredPlan={requiredPlan}
          />
        )}
      </main>
    </AppShell>
  );
}
