import { NextResponse } from "next/server";
import { z } from "zod";

import { features } from "@/config/features";
import { logAdminAction } from "@/lib/admin/audit";
import { authErrorResponse, authorizeApi } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { SUBSCRIPTION_STATUSES } from "@/lib/db/schema";

const schema = z
  .object({
    organizationId: z.string().min(1),
    planSlug: z.string().min(1).optional(),
    planId: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.planSlug || data.planId), {
    message: "A planSlug or planId is required",
    path: ["planSlug"],
  });

/**
 * Super-admin force-assign a plan to an org — no Stripe involved. Upserts the
 * org's subscription (`status: active`, `planId` set) so `getEffectivePlan`
 * resolves to the chosen plan immediately. Any existing Stripe ids are left
 * untouched; `planId` is the authority the entitlement resolver reads (§15).
 * Allowed for any plan, including the actor's own org. Audited.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!features.admin || !features.payments.enabled) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  try {
    const session = await authorizeApi(request, { superAdmin: true });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const { organizationId, planSlug, planId } = parsed.data;

    const org = await db.getOrganizationById(organizationId);
    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const plan = planId
      ? await db.getPlanById(planId)
      : await db.getPlanBySlug(planSlug!);
    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const existing = await db.getSubscriptionByOrg(organizationId);
    const subscription = existing
      ? await db.updateSubscription(existing.id, {
          planId: plan.id,
          status: SUBSCRIPTION_STATUSES.active,
          cancelAtPeriodEnd: false,
        })
      : await db.createSubscription({
          organizationId,
          planId: plan.id,
          status: SUBSCRIPTION_STATUSES.active,
          cancelAtPeriodEnd: false,
        });

    await logAdminAction(session, {
      action: "assign_plan",
      targetId: subscription.id,
      reason: `Force-assigned plan "${plan.name}"`,
      metadata: { organizationId, planId: plan.id, planSlug: plan.slug },
    });

    return NextResponse.json({ ok: true, subscription });
  } catch (error) {
    return authErrorResponse(error);
  }
}
