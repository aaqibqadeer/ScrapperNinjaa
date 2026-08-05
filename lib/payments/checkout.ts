/**
 * lib/payments/checkout.ts — checkout / billing-portal business logic (Phase 5).
 * Node-only. Route handlers stay thin (§3) and call these; the `payments` flag
 * check lives at the route boundary.
 */

import { env } from "@/config/env.schema";
import { features } from "@/config/features";
import { db } from "@/lib/db";
import type { Organization } from "@/lib/db/schema";
import type { Session } from "@/lib/auth/types";

import type { BillingCadence } from "./adapter";
import { payments } from "./index";

/** Return the org's Stripe customer id, creating + persisting it on first use. */
async function ensureCustomerId(
  session: Session,
  org: Organization,
): Promise<string> {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const { customerId } = await payments.createCustomer({
    email: session.user.email,
    name: session.user.name,
    metadata: { organizationId: org.id },
  });
  await db.updateOrganization(org.id, { stripeCustomerId: customerId });
  return customerId;
}

export async function startCheckout(
  session: Session,
  planId: string,
  cadence: BillingCadence,
): Promise<{ url: string }> {
  const organizationId = session.organizationId;
  if (!organizationId) throw new Error("No active organization");
  const org = await db.getOrganizationById(organizationId);
  if (!org) throw new Error("Organization not found");

  const plan = await db.getPlanById(planId);
  if (!plan || !plan.isActive) throw new Error("Plan not available");

  const useAnnual = cadence === "annual" && features.payments.annualBilling;
  const priceId = useAnnual
    ? plan.stripePriceIdAnnual
    : plan.stripePriceIdMonthly;
  if (!priceId) {
    throw new Error(
      `Plan "${plan.name}" has no Stripe ${useAnnual ? "annual" : "monthly"} price configured`,
    );
  }

  const customerId = await ensureCustomerId(session, org);
  const base = env.NEXT_PUBLIC_APP_URL;
  return payments.createCheckoutSession({
    priceId,
    customerId,
    successUrl: `${base}/leads?checkout=success`,
    cancelUrl: `${base}/settings/billing?checkout=cancelled`,
    // ApplyNinjaa's trial is local and card-free (lib/payments/trials.ts) —
    // never forward a Stripe trial_end, or setting trialDays would silently
    // reintroduce card-based trials at checkout.
    trialEnd: null,
    metadata: { organizationId: org.id, planId: plan.id },
  });
}

export async function openBillingPortal(
  session: Session,
): Promise<{ url: string }> {
  const organizationId = session.organizationId;
  if (!organizationId) throw new Error("No active organization");
  const org = await db.getOrganizationById(organizationId);
  if (!org?.stripeCustomerId) {
    throw new Error("No billing account yet — subscribe to a plan first");
  }
  const base = env.NEXT_PUBLIC_APP_URL;
  return payments.createBillingPortalSession({
    customerId: org.stripeCustomerId,
    returnUrl: `${base}/settings/billing`,
  });
}
