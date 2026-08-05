import { notFound } from "next/navigation";

import { AppShell } from "@/components/shared/AppShell";
import { InviteMemberForm } from "@/components/org/InviteMemberForm";
import { MemberList, type MemberRow } from "@/components/org/MemberList";
import {
  PendingInvites,
  type PendingInvite,
} from "@/components/org/PendingInvites";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { features } from "@/config/features";
import { requireRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { INVITATION_STATUSES } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * Organization settings — members, roles, and invitations. Multi-tenant only
 * and admin-only: `requireRole("admin")` is separate from super-admin (§14).
 * When `multiTenant` is off this route 404s (no org-management UI).
 */
export default async function OrganizationSettingsPage() {
  if (!features.multiTenant) notFound();
  const session = await requireRole("admin");
  if (!session.organizationId) notFound();
  const orgId = session.organizationId;

  const org = await db.getOrganizationById(orgId);
  const memberships = await db.listMembers(orgId);
  const members: MemberRow[] = await Promise.all(
    memberships.map(async (m) => {
      const user = await db.getUserById(m.userId);
      return {
        userId: m.userId,
        email: user?.email ?? "(unknown)",
        name: user?.name ?? null,
        role: m.role,
      };
    }),
  );

  const invitations = await db.listInvitations(orgId);
  const pending: PendingInvite[] = invitations
    .filter((invite) => invite.status === INVITATION_STATUSES.pending)
    .map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
    }));

  return (
    <AppShell session={session}>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Organization</h1>
          <p className="text-muted-foreground text-sm">
            {org?.name} — manage members and invitations.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              People with access to this organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MemberList members={members} currentUserId={session.user.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invite a member</CardTitle>
            <CardDescription>
              They&apos;ll receive an email link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteMemberForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Invitations not yet accepted.</CardDescription>
          </CardHeader>
          <CardContent>
            <PendingInvites invites={pending} />
          </CardContent>
        </Card>
      </main>
    </AppShell>
  );
}
