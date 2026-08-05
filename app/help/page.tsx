import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shared/AppShell";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";
import { listFiltersForUser } from "@/lib/filters/service";
import { getEffectivePlan } from "@/lib/payments/access";
import { getAiCallCap, getProfileLimit } from "@/lib/usage/enforce";

export const metadata: Metadata = { title: "How it works" };

export const dynamic = "force-dynamic";

/** One popup action: what it does and whether it spends an AI action. */
const ACTIONS: Array<[name: string, cost: string, what: string]> = [
  [
    "Check fit score",
    "1 AI action",
    "Reads the posting and returns your fit score plus a Yes/No/Neutral verdict for every filter. The result is cached for that page, so re-opening the popup costs nothing.",
  ],
  [
    "Quick Fill",
    "Free",
    "Fills the form from your profile by matching field labels directly — no AI involved. Your saved answers are matched first, so they always win over a guess. Keeps working after you hit your monthly cap.",
  ],
  [
    "AI Fill",
    "1 AI action",
    "Uses AI to map your profile onto the form, including open-ended questions it can answer from your background notes. Use it when Quick Fill leaves too much blank.",
  ],
  [
    "Track",
    "Free",
    "Saves the job to your dashboard as Applied, with the page URL, platform and date. If you already ran a fit score on that page, the score and verdicts are saved too.",
  ],
  [
    "Re-track",
    "Free",
    "Attaches the page you're on to a job you already tracked — for the same role on a second site, or the confirmation page after you submit.",
  ],
  [
    "Reset this page",
    "Free",
    "Clears the cached fit score for the current page so the next check starts fresh.",
  ],
];

export default async function HelpPage() {
  const session = await requireAuth();
  const [filters, { plan, source }] = await Promise.all([
    listFiltersForUser(session),
    getEffectivePlan(session),
  ]);
  const cap = getAiCallCap(plan);
  const profileLimit = getProfileLimit(plan);

  return (
    <AppShell session={session}>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="font-heading text-2xl font-semibold">How it works</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What the filter verdicts mean, what each extension button does, and
          what your plan includes.
        </p>

        <section className="mt-10">
          <h2 className="font-heading text-lg font-semibold">
            Yes, No and Neutral
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            These aren&rsquo;t a confidence scale — they answer three different
            questions. The one people expect to mean something else is{" "}
            <strong>Neutral</strong>.
          </p>
          <dl className="mt-4 flex flex-col gap-3">
            {(
              [
                [
                  "Yes",
                  "bg-success/15 text-success",
                  "The posting satisfies the filter — it says the thing you wanted to know.",
                ],
                [
                  "No",
                  "bg-destructive/15 text-destructive",
                  "The posting actively conflicts with what you asked for. This only appears when the posting says something incompatible.",
                ],
                [
                  "Neutral",
                  "bg-muted text-muted-foreground",
                  "The posting doesn't say. This is the most common verdict, and it is not a bad sign — most postings are simply silent on most things.",
                ],
              ] as const
            ).map(([verdict, className, meaning]) => (
              <div key={verdict} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
                >
                  {verdict}
                </span>
                <dd className="text-sm">{meaning}</dd>
              </div>
            ))}
          </dl>
          <div className="border-border bg-muted/30 mt-4 rounded-lg border p-4 text-sm">
            <p className="font-medium">Worked example</p>
            <p className="text-muted-foreground mt-1">
              On <em>Remote/Hybrid/Onsite Match</em>, with Remote as your
              preference: a posting that says &ldquo;5 days a week
              onsite&rdquo; is <strong>No</strong> — it conflicts with what you
              asked for. A posting that never mentions location is{" "}
              <strong>Neutral</strong> — not <strong>No</strong>. Silence is
              never treated as a refusal.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-heading text-lg font-semibold">Your filters</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Each enabled filter gets a verdict every time you check a job.
            Manage them in{" "}
            <Link href="/settings/filters" className="text-primary underline">
              filter settings
            </Link>
            .
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {filters.map((filter) => (
              <li key={filter.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{filter.label}</span>
                  {!filter.enabled && (
                    <span className="text-muted-foreground text-xs">(off)</span>
                  )}
                  {filter.type === "user" && (
                    <span className="text-muted-foreground text-xs">
                      (yours)
                    </span>
                  )}
                </div>
                {filter.description && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {filter.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="font-heading text-lg font-semibold">
            The extension buttons
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Opening the popup never costs an AI action. Only two buttons do.
          </p>
          <ul className="mt-4 flex flex-col gap-4">
            {ACTIONS.map(([name, cost, what]) => (
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
                {profileLimit === Infinity ? "Unlimited" : profileLimit}
              </strong>{" "}
              {profileLimit === 1 ? "profile" : "profiles"}.
            </li>
            <li>
              Custom filters:{" "}
              {plan.limits?.customFilters ? "included" : "not included"}.
            </li>
            {features.gmail && (
              <li>
                Gmail scanning:{" "}
                {plan.limits?.gmailScan ? "included" : "not included"}.
              </li>
            )}
            <li>
              CSV export: {plan.limits?.dataExport ? "included" : "not included"}
              .
            </li>
          </ul>
          <p className="text-muted-foreground mt-4 text-sm">
            When you reach your monthly cap, fit scores and AI Fill stop until
            the next month — but Quick Fill, Track and Re-track keep working,
            and nothing you&rsquo;ve already saved is affected. Your count
            resets on the 1st.{" "}
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
