import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ProfileEditor } from "@/components/profiles/ProfileEditor";
import { AppShell } from "@/components/shared/AppShell";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getEffectivePlan } from "@/lib/payments/access";
import { emptyProfileValues } from "@/lib/profiles/form-values";
import { getProfileLimit } from "@/lib/usage/enforce";

export const metadata: Metadata = { title: "New profile" };

export const dynamic = "force-dynamic";

export default async function NewProfilePage() {
  if (!features.jobApplications) notFound();
  const session = await requireAuth();

  // Don't let someone fill in a whole profile only to be refused on save —
  // createProfile() enforces the same limit server-side.
  const [profiles, { plan }] = await Promise.all([
    db.listProfilesForUser(session.user.id),
    getEffectivePlan(session),
  ]);
  if (profiles.length >= getProfileLimit(plan)) redirect("/profiles");

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="font-heading mb-6 text-2xl font-semibold">
          New profile
        </h1>
        <ProfileEditor initial={{ ...emptyProfileValues, name: "" }} />
      </main>
    </AppShell>
  );
}
