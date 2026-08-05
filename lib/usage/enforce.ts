/**
 * lib/usage/enforce.ts — the per-plan monthly AI cap (hard block) and the
 * shared guard sequence every AI route runs.
 *
 * Cap source: the effective plan's `limits.aiCallsPerMonth`
 * (lib/payments/access.ts → Free fallback, lazy trial expiry). At the cap the
 * route hard-blocks with 402 + an upgrade payload — no queueing, no soft
 * warnings (product spec).
 */

import { features } from "@/config/features";
import type { Session } from "@/lib/auth/types";
import { sendAiLimitReachedEmail } from "@/lib/email/templates";
import {
  EntitlementError,
  getEffectivePlan,
  lowestPlanWithLimitAbove,
  readNumericLimit,
  type EffectivePlan,
} from "@/lib/payments/access";

import {
  currentPeriod,
  decrementMonthlyAiUsage,
  incrementMonthlyAiUsage,
} from "./ai-usage";
import { enforceRateLimit, requestIp } from "./rate-limit";

const LEAD_LIMIT_KEY = "leadLimit";
const LEAD_LIMIT_FALLBACK = 100;
const CAMPAIGN_LIMIT_KEY = "campaignLimit";
const CAMPAIGN_LIMIT_FALLBACK = 2;

/** Short-window abuse limits, on top of the monthly cap. */
const PER_USER_LIMIT = { limit: 20, windowSeconds: 60 };
const PER_IP_LIMIT = { limit: 60, windowSeconds: 60 };

export class UsageLimitError extends Error {
  readonly status = 402;
  readonly payload: {
    code: "AI_CAP_REACHED";
    used: number;
    cap: number;
    planSlug: string;
    upgradeUrl: string;
  };
  constructor(used: number, cap: number, planSlug: string) {
    super(
      `You've used all ${cap} AI actions on your plan this month — upgrade to keep going`,
    );
    this.name = "UsageLimitError";
    this.payload = {
      code: "AI_CAP_REACHED",
      used,
      cap,
      planSlug,
      upgradeUrl: "/settings/billing",
    };
  }
}

/** Typed read of the plan's monthly AI call cap (0 when absent/malformed). */
export function getAiCallCap(plan: EffectivePlan["plan"]): number {
  const raw = plan.limits?.aiCallsPerMonth;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/**
 * The plan's max lead count (ScrapperNinja). `-1` → unlimited (Infinity), an
 * absent/malformed value falls back to the Free allowance. Deliberately NOT
 * `hasAccess()`, which would coerce any positive number to `true`.
 */
export function getLeadLimit(plan: EffectivePlan["plan"]): number {
  return readNumericLimit(plan, LEAD_LIMIT_KEY, LEAD_LIMIT_FALLBACK);
}

/**
 * The plan's max campaign count (ScrapperNinja). Same semantics as
 * `getLeadLimit` — `-1` unlimited, malformed/absent falls back to Free.
 */
export function getCampaignLimit(plan: EffectivePlan["plan"]): number {
  return readNumericLimit(plan, CAMPAIGN_LIMIT_KEY, CAMPAIGN_LIMIT_FALLBACK);
}

/**
 * Assert the org has room for one more lead. Like the profile limit, this gates
 * CREATION only — a downgrade never deletes existing leads, it just blocks
 * adding more. No-op when payments is off.
 */
export async function enforceLeadLimit(
  session: Session,
  currentCount: number,
): Promise<void> {
  if (!features.payments.enabled) return;
  const { plan } = await getEffectivePlan(session);
  const limit = getLeadLimit(plan);
  if (currentCount < limit) return;
  const upgrade = await lowestPlanWithLimitAbove(
    LEAD_LIMIT_KEY,
    limit,
    LEAD_LIMIT_FALLBACK,
  );
  throw new EntitlementError(
    LEAD_LIMIT_KEY,
    upgrade?.name ?? null,
    `Your plan includes ${limit} leads — upgrade to store more`,
  );
}

/**
 * Assert the org has room for one more campaign. Creation-only gate, no-op when
 * payments is off (see `enforceLeadLimit`).
 */
export async function enforceCampaignLimit(
  session: Session,
  currentCount: number,
): Promise<void> {
  if (!features.payments.enabled) return;
  const { plan } = await getEffectivePlan(session);
  const limit = getCampaignLimit(plan);
  if (currentCount < limit) return;
  const upgrade = await lowestPlanWithLimitAbove(
    CAMPAIGN_LIMIT_KEY,
    limit,
    CAMPAIGN_LIMIT_FALLBACK,
  );
  throw new EntitlementError(
    CAMPAIGN_LIMIT_KEY,
    upgrade?.name ?? null,
    `Your plan includes ${limit} campaigns — upgrade to create more`,
  );
}

export interface QuotaResult {
  used: number;
  cap: number;
  effective: EffectivePlan;
}

/**
 * Consume one AI call from the user's monthly quota, throwing UsageLimitError
 * (402, upgrade payload) at the cap. Increment-first with refund-on-overshoot
 * so the hard cap holds under concurrency.
 */
export async function enforceAiQuota(session: Session): Promise<QuotaResult> {
  const effective = await getEffectivePlan(session);
  const cap = getAiCallCap(effective.plan);
  const period = currentPeriod();
  const used = await incrementMonthlyAiUsage(session.user.id, period);
  if (used > cap) {
    await decrementMonthlyAiUsage(session.user.id, period);
    throw new UsageLimitError(cap, cap, effective.plan.slug);
  }
  if (used === cap) {
    // The atomic counter hits == cap exactly once per period, so this fires
    // one transactional limit warning, never a stream of them. Best-effort.
    sendAiLimitReachedEmail({ email: session.user.email }, cap).catch(() => {});
  }
  return { used, cap, effective };
}

/**
 * The short-window abuse limits (per user AND per IP). Run before the quota
 * so hammering can't even reach the counter.
 */
export async function enforceAiRateLimits(
  request: Request,
  session: Session,
): Promise<void> {
  await enforceRateLimit({
    key: `ai:ip:${requestIp(request)}`,
    ...PER_IP_LIMIT,
  });
  await enforceRateLimit({
    key: `ai:user:${session.user.id}`,
    ...PER_USER_LIMIT,
  });
}
