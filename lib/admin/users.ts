/**
 * lib/admin/users.ts — platform user management (Node).
 *
 * Joins users → default org → subscription → plan, plus this month's AI
 * usage, without N+1 queries (batched adapter methods + bulk usage lookup).
 */

import { db, USER_STATUSES, type User } from "@/lib/db";
import { getMonthlyAiUsageBulk } from "@/lib/usage/ai-usage";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  status: User["status"];
  emailVerified: boolean;
  isSuperAdmin: boolean;
  isSupportAdmin: boolean;
  /** The user's default org (the billing entity) — null if none resolved.
   * Powers the super-admin "Assign plan" action. */
  organizationId: string | null;
  planName: string;
  subscriptionStatus: string | null;
  usageThisMonth: number;
  createdAt: Date;
}

export interface AdminUserList {
  rows: AdminUserRow[];
  total: number;
}

export async function listUsersWithBilling(params: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminUserList> {
  const { users, total } = await db.listUsers(params);
  const userIds = users.map((u) => u.id);

  const [memberships, usage] = await Promise.all([
    db.listMembershipsForUsers(userIds),
    getMonthlyAiUsageBulk(userIds),
  ]);

  // First membership per user = their default org (single-tenant fork).
  const orgByUser = new Map<string, string>();
  for (const membership of memberships) {
    if (!orgByUser.has(membership.userId)) {
      orgByUser.set(membership.userId, membership.organizationId);
    }
  }

  const subscriptions = await db.listSubscriptionsForOrgs(
    Array.from(new Set(orgByUser.values())),
  );
  const subByOrg = new Map(subscriptions.map((s) => [s.organizationId, s]));

  const plans = await db.listPlans();
  const planById = new Map(plans.map((p) => [p.id, p]));

  const rows = users.map((user) => {
    const orgId = orgByUser.get(user.id);
    const subscription = orgId ? subByOrg.get(orgId) : undefined;
    const live =
      subscription &&
      (subscription.status === "active" || subscription.status === "trialing");
    const plan = live ? planById.get(subscription.planId) : undefined;
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      status: user.status,
      emailVerified: Boolean(user.emailVerifiedAt),
      isSuperAdmin: user.isSuperAdmin,
      isSupportAdmin: user.isSupportAdmin,
      organizationId: orgId ?? null,
      planName: plan?.name ?? "Free",
      subscriptionStatus: subscription?.status ?? null,
      usageThisMonth: usage.get(user.id) ?? 0,
      createdAt: user.createdAt,
    };
  });

  return { rows, total };
}

/** Suspend/unsuspend/ban — blocks login immediately, retains all data. */
export async function setUserStatus(
  userId: string,
  status: (typeof USER_STATUSES)[keyof typeof USER_STATUSES],
): Promise<User> {
  return db.updateUser(userId, { status });
}

/** Trigger the 30-day soft delete (recoverable until hard-delete runs). */
export async function softDeleteUser(userId: string): Promise<User> {
  return db.updateUser(userId, {
    status: USER_STATUSES.pending_deletion,
    deletedAt: new Date(),
  });
}
