import type { ReactNode } from "react";

import { AppSidebar } from "@/components/shared/AppSidebar";
import type { AppNavLink } from "@/components/shared/AppNav";
import type { WorkspaceOption } from "@/components/shared/WorkspaceSwitcher";
import { features } from "@/config/features";
import type { Session } from "@/lib/auth/types";
import { db } from "@/lib/db";
import { ORG_ROLES } from "@/lib/db/schema";

interface AppShellProps {
  session: Session;
  children: ReactNode;
}

/**
 * Signed-in app chrome: collapsible left sidebar + scroll-contained main area.
 * Replaces the old top `AppHeader` bar for a denser leads-table layout.
 */
export async function AppShell({ session, children }: AppShellProps) {
  const isOrgAdmin = session.role === ORG_ROLES.admin;
  const isSuperAdmin = session.user.isSuperAdmin;

  const links: AppNavLink[] = [
    ...(features.jobApplications
      ? [
          { href: "/dashboard", label: "Dashboard" },
          { href: "/profiles", label: "Profiles" },
          { href: "/settings/filters", label: "Filters" },
        ]
      : []),
    ...(features.gmail && features.jobApplications
      ? [{ href: "/settings/gmail", label: "Gmail" }]
      : []),
    ...(features.scraper.enabled
      ? [
          { href: "/leads", label: "Leads" },
          { href: "/leads/campaigns", label: "Campaigns" },
          { href: "/leads/duplicates", label: "Duplicates" },
          ...(features.scraper.offerLines
            ? [{ href: "/leads/prompts", label: "Prompts" }]
            : []),
          { href: "/leads/sessions", label: "Sessions" },
        ]
      : []),
    ...(features.payments.enabled
      ? [{ href: "/settings/billing", label: "Billing" }]
      : []),
    { href: "/settings/account", label: "Account" },
    { href: "/help", label: "Help" },
    ...(features.multiTenant && isOrgAdmin
      ? [{ href: "/settings/organization", label: "Organization" }]
      : []),
    ...(features.admin && (isSuperAdmin || session.user.isSupportAdmin)
      ? [{ href: "/admin", label: "Admin" }]
      : []),
  ];

  let workspaces: WorkspaceOption[] = [];
  if (features.multiTenant) {
    const memberships = await db.listMembershipsForUser(session.user.id);
    const orgs = await Promise.all(
      memberships.map((m) => db.getOrganizationById(m.organizationId)),
    );
    workspaces = orgs
      .filter((org): org is NonNullable<typeof org> => org !== null)
      .map((org) => ({ id: org.id, name: org.name }));
  }

  const homeHref =
    features.scraper.enabled && !features.jobApplications
      ? "/leads"
      : "/dashboard";

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar
        links={links}
        homeHref={homeHref}
        workspaces={workspaces}
        activeOrgId={session.organizationId ?? ""}
        userEmail={session.user.email ?? ""}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
