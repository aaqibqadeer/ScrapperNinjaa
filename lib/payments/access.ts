/**
 * lib/payments/access.ts — plan resolution + feature gating (§15).
 *
 * `getEffectivePlan(session)` is the single quota/entitlement resolver: the
 * org's live subscription (with lazy local-trial expiry applied), else the
 * Free plan. Every cap/entitlement read goes through it so "no subscription
 * row" always means Free — never "locked out".
 *
 * `hasAccess(session, feature)` answers the boolean "is this feature
 * available?" from the effective plan's `limits` JSON. It ALWAYS returns true
 * when payments is off, so feature-gating call sites never need their own
 * payments-on/off branch — this is the one place that knows about the flag.
 */

import { features } from "@/config/features";
import {
  db,
  PLAN_SLUGS,
  SUBSCRIPTION_STATUSES,
  type Plan,
  type Subscription,
} from "@/lib/db";
import type { Session } from "@/lib/auth/types";

import { applyLazyTrialExpiry } from "./trials";

export type PlanSource = "paid" | "trial" | "free";

export interface EffectivePlan {
  plan: Plan;
  /** The live subscription row, or null when resolved to the Free fallback. */
  subscription: Subscription | null;
  source: PlanSource;
}

export async function getEffectivePlan(session: Session): Promise<EffectivePlan> {
  const organizationId = session.organizationId;

  if (features.payments.enabled && organizationId) {
    let subscription = await db.getSubscriptionByOrg(organizationId);
    if (subscription) {
      subscription = await applyLazyTrialExpiry(subscription);
      const isLive =
        subscription.status === SUBSCRIPTION_STATUSES.active ||
        subscription.status === SUBSCRIPTION_STATUSES.trialing;
      if (isLive) {
        const plan = await db.getPlanById(subscription.planId);
        if (plan?.isActive) {
          return {
            plan,
            subscription,
            source:
              subscription.status === SUBSCRIPTION_STATUSES.trialing
                ? "trial"
                : "paid",
          };
        }
      }
    }
  }

  const freePlan = await db.getPlanBySlug(PLAN_SLUGS.free);
  if (!freePlan) {
    throw new Error(
      'The "free" plan is missing — run the seed script (npm run seed)',
    );
  }
  return { plan: freePlan, subscription: null, source: "free" };
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string")
    return value.length > 0 && value !== "false" && value !== "0";
  // A non-empty object/array counts as "present" (e.g. an enabled feature blob).
  if (value && typeof value === "object") return true;
  return false;
}

export async function hasAccess(
  session: Session,
  feature: string,
): Promise<boolean> {
  if (!features.payments.enabled) return true;
  const { plan } = await getEffectivePlan(session);
  return toBoolean(plan.limits?.[feature]);
}

/**
 * Boolean entitlement keys stored in `plans.limits` (§15 — limits is an open
 * JSON blob, so adding one is a seed/admin edit, never a migration).
 * Numeric limits (aiCallsPerMonth, leadLimit, campaignLimit) are NOT listed here: they are
 * read with the typed helpers in `lib/usage/enforce.ts`, because `toBoolean`
 * would report any positive number as "allowed".
 */
export const PLAN_FEATURES = {
  enrichment: "enrichment",
  offerLines: "offerLines",
  dataExport: "dataExport",
} as const;

export type PlanFeature = (typeof PLAN_FEATURES)[keyof typeof PLAN_FEATURES];

/**
 * Thrown when the effective plan doesn't include a feature. Shaped like
 * UsageLimitError so the existing `catch → authErrorResponse(error)` tail on
 * every route serves it unchanged (spreads `.payload`, honours `.status`), and
 * so the extension's existing `code`/`upgradeUrl` handling just works.
 */
export class EntitlementError extends Error {
  readonly status = 402;
  readonly payload: {
    code: "FEATURE_LOCKED";
    feature: string;
    requiredPlan: string | null;
    upgradeUrl: string;
  };
  constructor(feature: string, requiredPlan: string | null, message?: string) {
    super(
      message ??
        (requiredPlan
          ? `That's a ${requiredPlan} feature — upgrade to use it`
          : "That feature isn't included in your plan"),
    );
    this.name = "EntitlementError";
    this.payload = {
      code: "FEATURE_LOCKED",
      feature,
      requiredPlan,
      upgradeUrl: "/settings/billing",
    };
  }
}

/**
 * Typed read of a numeric `limits` key. `-1` (any negative) means unlimited →
 * Infinity; absent or malformed → `fallback`. The single coercion used by
 * every numeric limit, so plans configured with `"150"` behave like `150`.
 */
export function readNumericLimit(
  plan: Plan,
  key: string,
  fallback: number,
): number {
  const raw = plan.limits?.[key];
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 0) return Infinity;
  return Math.floor(value);
}

/**
 * The cheapest active plan whose numeric `key` limit exceeds `current` — the
 * upsell target when someone hits a countable limit. Null when nothing on the
 * price list would actually give them more.
 */
export async function lowestPlanWithLimitAbove(
  key: string,
  current: number,
  fallback: number,
): Promise<Plan | null> {
  const plans = await db.listPlans();
  return (
    plans
      .filter(
        (plan) => plan.isActive && readNumericLimit(plan, key, fallback) > current,
      )
      .sort(
        (a, b) => a.priceMonthly - b.priceMonthly || a.sortOrder - b.sortOrder,
      )[0] ?? null
  );
}

/**
 * The cheapest active plan that includes `feature`, by price then sort order —
 * read from the plans table so the upsell never hardcodes a plan name (§15).
 * Null when no active plan offers it.
 */
export async function lowestPlanWith(feature: string): Promise<Plan | null> {
  const plans = await db.listPlans();
  const eligible = plans
    .filter((plan) => plan.isActive && toBoolean(plan.limits?.[feature]))
    .sort(
      (a, b) => a.priceMonthly - b.priceMonthly || a.sortOrder - b.sortOrder,
    );
  return eligible[0] ?? null;
}

/**
 * Assert a boolean entitlement, throwing EntitlementError (402 + upsell
 * payload) when the plan doesn't include it. Server-side authority — the UI
 * hides locked affordances, but this is what actually enforces them.
 */
export async function requireFeature(
  session: Session,
  feature: PlanFeature,
  message?: string,
): Promise<void> {
  if (await hasAccess(session, feature)) return;
  const required = await lowestPlanWith(feature);
  throw new EntitlementError(feature, required?.name ?? null, message);
}
