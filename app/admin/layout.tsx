import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { AppShell } from "@/components/shared/AppShell";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * Platform admin shell. Gated on the `admin` flag (404 when off) and entered
 * ONLY by platform staff — super admins (full access) or support admins
 * (view users, refunds). In this fork every user is org-admin of their own
 * silent default org (§1.3), so the template's org-admin entry would admit
 * everyone; org roles deliberately do NOT open this panel (§14). Each page
 * still enforces its own tier guard.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!features.admin) notFound();

  const session = await requireAuth();
  const isSuperAdmin = session.user.isSuperAdmin;
  const isSupportAdmin = session.user.isSupportAdmin;
  if (!isSuperAdmin && !isSupportAdmin) notFound();

  return (
    <AppShell session={session}>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-muted-foreground text-sm">
            {isSuperAdmin
              ? "Platform administration."
              : "Support tools — users and refunds."}
          </p>
        </div>
        <AdminNav
          isSuperAdmin={isSuperAdmin}
          isSupportAdmin={isSupportAdmin}
          paymentsEnabled={features.payments.enabled}
          scraperEnabled={features.scraper.enabled}
        />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
