import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ManageBillingButton } from "@/components/billing/ManageBillingButton";
import { PlanPicker, type PlanCardData } from "@/components/billing/PlanPicker";
import { AppShell } from "@/components/shared/AppShell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getEffectivePlan } from "@/lib/payments/access";
import { getMonthlyAiUsage } from "@/lib/usage/ai-usage";
import { getAiCallCap } from "@/lib/usage/enforce";

export const metadata: Metadata = { title: "Billing" };

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  if (!features.payments.enabled) notFound();
  const session = await requireAuth();

  const [effective, used, plans] = await Promise.all([
    getEffectivePlan(session),
    getMonthlyAiUsage(session.user.id),
    db.listActivePlans(),
  ]);
  const cap = getAiCallCap(effective.plan);

  const trialDaysLeft =
    effective.source === "trial" && effective.subscription?.currentPeriodEnd
      ? Math.max(
          0,
          Math.ceil(
            (effective.subscription.currentPeriodEnd.getTime() - Date.now()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : null;

  const planCards: PlanCardData[] = plans.map((plan) => ({
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description ?? null,
    priceMonthly: plan.priceMonthly,
    priceAnnual: plan.priceAnnual ?? null,
    aiCallsPerMonth: getAiCallCap(plan),
  }));

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold">Billing</h1>
          <p className="text-muted-foreground text-sm">
            Your plan, this month&apos;s AI usage, and upgrades.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current plan</CardTitle>
              <CardDescription>
                {effective.plan.name}
                {effective.source === "trial" && trialDaysLeft !== null
                  ? ` — free trial, ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`
                  : effective.source === "free"
                    ? " — free tier"
                    : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              {effective.source === "trial" && (
                <p className="text-muted-foreground text-xs">
                  No card on file — you&apos;ll drop to Free when the trial
                  ends unless you subscribe.
                </p>
              )}
              {effective.subscription?.stripeSubscriptionId && (
                <ManageBillingButton />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI usage this month</CardTitle>
              <CardDescription>
                {used} of {cap} AI actions used
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress
                value={cap > 0 ? (used / cap) * 100 : 100}
                aria-label="AI usage"
              />
              {used >= cap && (
                <p className="text-destructive mt-2 text-xs">
                  You&apos;ve hit your monthly limit — AI actions are paused
                  until you upgrade or the month resets.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <h2 className="mb-4 text-lg font-semibold">Plans</h2>
        <PlanPicker
          plans={planCards}
          currentPlanSlug={effective.plan.slug}
          annualBilling={features.payments.annualBilling}
        />
      </main>
    </AppShell>
  );
}
