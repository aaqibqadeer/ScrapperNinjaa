import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shared/AppShell";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";
import { getEffectivePlan } from "@/lib/payments/access";
import {
  getAiCallCap,
  getCampaignLimit,
  getLeadLimit,
} from "@/lib/usage/enforce";

export const metadata: Metadata = { title: "How it works" };

export const dynamic = "force-dynamic";

const EXTENSION_ACTIONS: Array<[name: string, cost: string, what: string]> = [
  [
    "Capture",
    "Free",
    "Harvests businesses from the current directory page into your selected campaign. Fast mode reads list cards; Deep mode opens each card for phone, website, and hours when the site supports it.",
  ],
  [
    "Capture this page",
    "Free",
    "Manual tier-d capture for a single business page when auto list harvesting is not available.",
  ],
  [
    "Rescue (dashboard)",
    "1 AI action per lead",
    "Repairs rows stuck in needs review — run from the Leads toolbar when the review queue builds up.",
  ],
  [
    "Enrich / score / offer (dashboard)",
    "1+ AI actions per lead",
    "Batch jobs on the Leads page normalize, enrich, score, and draft opening lines. Each pass consumes quota.",
  ],
];

export default async function HelpPage() {
  const session = await requireAuth();
  const { plan, source } = await getEffectivePlan(session);
  const cap = getAiCallCap(plan);
  const leadLimit = getLeadLimit(plan);
  const campaignLimit = getCampaignLimit(plan);

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="font-heading text-2xl font-semibold">How it works</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Capture flow, AI passes, and what your plan includes.
        </p>

        <section className="mt-10">
          <h2 className="font-heading text-lg font-semibold">Lead Directory</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Captures sync to{" "}
            <Link href="/leads" className="text-primary underline">
              Leads
            </Link>
            . Filter, sort, hide columns, save views, and fix bad parses inline.
            Rows in <strong>needs review</strong> failed parsing — use Rescue or
            edit them manually before export.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-heading text-lg font-semibold">
            Extension + dashboard actions
          </h2>
          <ul className="mt-4 flex flex-col gap-4">
            {EXTENSION_ACTIONS.map(([name, cost, what]) => (
              <li key={name} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      cost === "Free"
                        ? "bg-success/15 text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {cost}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">{what}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="font-heading text-lg font-semibold">Your plan</h2>
          <p className="mt-2 text-sm">
            You&rsquo;re on <strong>{plan.name}</strong>
            {source === "trial" ? " (free trial)" : ""}.
          </p>
          <ul className="text-muted-foreground mt-3 flex flex-col gap-1.5 text-sm">
            <li>
              <strong className="text-foreground">{cap}</strong> AI actions a
              month.
            </li>
            <li>
              <strong className="text-foreground">
                {leadLimit === Infinity ? "Unlimited" : leadLimit}
              </strong>{" "}
              leads stored.
            </li>
            <li>
              <strong className="text-foreground">
                {campaignLimit === Infinity ? "Unlimited" : campaignLimit}
              </strong>{" "}
              campaigns.
            </li>
            <li>
              Enrichment:{" "}
              {plan.limits?.enrichment ? "included" : "not included"}.
            </li>
            <li>
              Offer lines:{" "}
              {plan.limits?.offerLines ? "included" : "not included"}.
            </li>
            <li>
              CSV export: {plan.limits?.dataExport ? "included" : "not included"}
              .
            </li>
          </ul>
          <p className="text-muted-foreground mt-4 text-sm">
            When you reach your monthly AI cap, rescue and batch AI jobs stop
            until the next month — capture and manual edits keep working. Your
            count resets on the 1st.{" "}
            {features.payments.enabled && (
              <Link href="/settings/billing" className="text-primary underline">
                See plans
              </Link>
            )}
          </p>
        </section>
      </main>
    </AppShell>
  );
}
