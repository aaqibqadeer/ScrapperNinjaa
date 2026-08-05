import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { AppShell } from "@/components/shared/AppShell";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Get started" };

// Per-user page (reads the session cookie) — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (!features.jobApplications) notFound();
  const session = await requireAuth();
  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <OnboardingWizard />
      </main>
    </AppShell>
  );
}
