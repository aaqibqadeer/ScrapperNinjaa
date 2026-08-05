import { notFound } from "next/navigation";

import { AcceptInviteButton } from "@/components/org/AcceptInviteButton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { features } from "@/config/features";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { INVITATION_STATUSES } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

/**
 * Invitation accept page. Middleware sends unauthenticated visitors to
 * /login?next=… first, so by here we have a session. We validate the invite
 * server-side and only offer "Accept" when it's actually acceptable.
 */
export default async function InvitePage({ params }: InvitePageProps) {
  if (!features.multiTenant) notFound();
  const session = await requireAuth();
  const { token } = await params;

  const invitation = await db.getInvitationByToken(token);
  const org = invitation
    ? await db.getOrganizationById(invitation.organizationId)
    : null;

  let problem: string | null = null;
  if (!invitation) {
    problem = "This invitation link is not valid.";
  } else if (invitation.status !== INVITATION_STATUSES.pending) {
    problem = "This invitation is no longer available.";
  } else if (invitation.expiresAt.getTime() < Date.now()) {
    problem = "This invitation has expired.";
  } else if (
    invitation.email.toLowerCase() !== session.user.email.toLowerCase()
  ) {
    problem = `This invitation was sent to ${invitation.email}. You're signed in as ${session.user.email}.`;
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {org ? `Join ${org.name}` : "Organization invitation"}
          </CardTitle>
          <CardDescription>
            {problem ??
              `You've been invited to join ${org?.name ?? "an organization"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {problem ? (
            <a
              href="/leads"
              className="text-sm underline underline-offset-4"
            >
              Go to Leads
            </a>
          ) : (
            <AcceptInviteButton token={token} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
