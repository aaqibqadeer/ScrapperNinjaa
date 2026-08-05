import { AdminUsersTable } from "@/components/admin/AdminUsersTable";
import type { PlanOption } from "@/components/admin/AssignPlanDialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { features } from "@/config/features";
import { requirePlatformStaff } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Platform user management (product spec §9): search/view all users with
 * plan tier and month-to-date AI usage. Support admins can view; suspend/
 * ban/reactivate and the deletion trigger are super-admin-only (enforced in
 * the routes, not just hidden here).
 */
export default async function AdminUsersPage() {
  const session = await requirePlatformStaff();

  // Super admins can force-assign any active plan (no Stripe) — only meaningful
  // when payments is on (subscriptions/entitlements are payments-gated).
  const plans: PlanOption[] =
    session.user.isSuperAdmin && features.payments.enabled
      ? (await db.listPlans())
          .filter((plan) => plan.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((plan) => ({ id: plan.id, slug: plan.slug, name: plan.name }))
      : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          Every account on the platform — plan, usage, and account status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AdminUsersTable
          isSuperAdmin={session.user.isSuperAdmin}
          plans={plans}
        />
      </CardContent>
    </Card>
  );
}
