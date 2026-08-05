/**
 * scripts/hard-delete.ts — permanently remove PII for accounts whose 30-day
 * soft-delete window has passed (`npm run hard-delete`, run on a schedule —
 * e.g. daily cron).
 *
 * Deletes: auth credentials, the default org + membership + subscription rows,
 * and the user record itself. Anonymized usage counters/logs are retained —
 * after the user row is gone their ObjectId no longer identifies anyone (product
 * spec §12).
 *
 * Uses adapter methods where they exist; operational collections owned by
 * Mongo-only modules (credentials, tokens, settings) are purged directly by
 * collection name — this is a maintenance script, not app code.
 */

import mongoose from "mongoose";

import "./load-env";
import { db, USER_STATUSES } from "@/lib/db";
import { connectMongo } from "@/lib/db/mongodb/adapter";

const WINDOW_DAYS = 30;

async function purgeCollection(
  name: string,
  filter: Record<string, unknown>,
): Promise<void> {
  await mongoose.connection.collection(name).deleteMany(filter);
}

async function hardDeleteUser(userId: string): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);

  // Auth credential (bcrypt hash).
  await purgeCollection("auth_credentials", { user_id: uid });

  // Default org + membership + its subscription rows.
  const memberships = await db.listMembershipsForUser(userId);
  for (const membership of memberships) {
    const orgId = membership.organizationId;
    await db.removeMember(orgId, userId);
    const remaining = await db.listMembers(orgId);
    if (remaining.length === 0) {
      await purgeCollection("subscriptions", {
        organization_id: new mongoose.Types.ObjectId(orgId),
      });
      await db.deleteOrganization(orgId);
    }
  }

  // Finally, the identity itself.
  await db.deleteUser(userId);
}

async function main(): Promise<void> {
  await connectMongo();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Page through pending-deletion users whose window has passed.
  const { users } = await db.listUsers({ limit: 500 });
  const due = users.filter(
    (u) =>
      u.status === USER_STATUSES.pending_deletion &&
      u.deletedAt &&
      u.deletedAt.getTime() < cutoff.getTime(),
  );

  if (due.length === 0) {
    console.log("No accounts past the deletion window.");
  }
  for (const user of due) {
    console.log(`Hard-deleting ${user.email} (soft-deleted ${user.deletedAt?.toISOString()})…`);
    await hardDeleteUser(user.id);
  }
  console.log(`Done — ${due.length} account(s) permanently deleted.`);

  await db.disconnect?.();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Hard delete failed:", error);
    process.exit(1);
  });
