import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProfileList } from "@/components/profiles/ProfileList";
import { AppShell } from "@/components/shared/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { UpgradeNotice } from "@/components/shared/UpgradeNotice";
import { Button } from "@/components/ui/button";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import {
  getEffectivePlan,
  lowestPlanWithLimitAbove,
} from "@/lib/payments/access";
import { getProfileLimit } from "@/lib/usage/enforce";

export const metadata: Metadata = { title: "Profiles" };

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  if (!features.jobApplications) notFound();
  const session = await requireAuth();
  const profiles = await db.listProfilesForUser(session.user.id);

  // Limits gate creation only — every existing profile stays fully editable
  // after a downgrade (we never delete user data on downgrade).
  const { plan } = await getEffectivePlan(session);
  const limit = getProfileLimit(plan);
  const atLimit = profiles.length >= limit;
  const upgradePlan = atLimit
    ? ((await lowestPlanWithLimitAbove("profileLimit", limit, 1))?.name ?? null)
    : null;

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold">Profiles</h1>
            <p className="text-muted-foreground text-sm">
              Separate profiles for separate tracks (e.g. “Frontend” vs
              “Backend/AI”) — pick one in the extension before autofilling.
            </p>
          </div>
          {atLimit ? (
            <Button asChild variant="outline">
              <Link href="/settings/billing">
                {upgradePlan ? `Upgrade for more` : "Profile limit reached"}
              </Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/profiles/new">New profile</Link>
            </Button>
          )}
        </div>

        {profiles.length === 0 ? (
          <EmptyState
            title="No profiles yet"
            description="Upload your resume to create your first profile."
            action={
              <Button asChild size="sm">
                <Link href="/onboarding">Start setup</Link>
              </Button>
            }
          />
        ) : (
          <ProfileList
            profiles={profiles.map((p) => ({
              id: p.id,
              name: p.name,
              isDefault: p.isDefault,
              updatedAt: p.updatedAt.toISOString(),
            }))}
          />
        )}

        {atLimit && (
          <div className="mt-6">
            <UpgradeNotice
              title={
                limit === 1
                  ? "Your plan includes one profile"
                  : `Your plan includes ${limit} profiles`
              }
              description="Extra profiles let you keep separate resumes and answers for different tracks — for example Frontend versus Backend/AI — and pick one per application."
              requiredPlan={upgradePlan}
            />
          </div>
        )}
      </main>
    </AppShell>
  );
}
