"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AssignPlanDialog,
  type PlanOption,
} from "@/components/admin/AssignPlanDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { RowNumberCell } from "@/components/shared/RowNumberCell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  status: string;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  isSupportAdmin: boolean;
  organizationId: string | null;
  planName: string;
  subscriptionStatus: string | null;
  usageThisMonth: number;
}

interface AdminUsersTableProps {
  /** Suspend/ban/delete are super-admin-only; support admins just view. */
  isSuperAdmin: boolean;
  /** Assignable plans (super-admin "Assign plan"); empty hides the action. */
  plans?: PlanOption[];
}

const PAGE_SIZE = 25;

/** Platform user management: search, plan tier, monthly usage, and (for
 * super admins) suspend/ban/reactivate + deletion trigger — all with audited
 * reasons. */
export function AdminUsersTable({
  isSuperAdmin,
  plans = [],
}: AdminUsersTableProps) {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async (q: string, off: number) => {
    const params = new URLSearchParams();
    if (q) params.set("search", q);
    if (off) params.set("offset", String(off));
    const res = await fetch(`/api/admin/users?${params.toString()}`);
    if (!res.ok) {
      toast.error("Could not load users");
      return;
    }
    const data = (await res.json()) as { rows: UserRow[]; total: number };
    setRows(data.rows);
    setTotal(data.total);
  }, []);

  useEffect(() => {
    void load("", 0);
  }, [load]);

  async function act(
    path: "status" | "delete",
    body: Record<string, unknown>,
  ): Promise<void> {
    const res = await fetch(`/api/admin/users/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Action failed");
    await load(search, offset);
  }

  function reasonInput(key: string) {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={`reason-${key}`}>Reason (required, audited)</Label>
        <Input
          id={`reason-${key}`}
          value={reasons[key] ?? ""}
          onChange={(e) =>
            setReasons((prev) => ({ ...prev, [key]: e.target.value }))
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          void load(search, 0);
        }}
      >
        <Input
          placeholder="Search email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      {rows === null ? (
        <p className="text-muted-foreground text-sm">Loading users…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-right">#</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>AI usage (mo)</TableHead>
                  {isSuperAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-right">
                      <RowNumberCell
                        index={index}
                        page={offset / PAGE_SIZE + 1}
                        pageSize={PAGE_SIZE}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="flex items-center gap-1.5 text-sm">
                          {row.email}
                          {row.isSuperAdmin && (
                            <Badge variant="secondary">super</Badge>
                          )}
                          {row.isSupportAdmin && (
                            <Badge variant="outline">support</Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {row.name ?? "—"}
                          {row.emailVerified ? "" : " · unverified"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "active"
                            ? "secondary"
                            : row.status === "pending_deletion"
                              ? "outline"
                              : "destructive"
                        }
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.planName}
                      {row.subscriptionStatus === "trialing" ? " (trial)" : ""}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.usageThisMonth}
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {plans.length > 0 && row.organizationId && (
                            <AssignPlanDialog
                              organizationId={row.organizationId}
                              plans={plans}
                              targetLabel={row.email}
                              onAssigned={() => void load(search, offset)}
                            />
                          )}
                          {row.status === "active" ? (
                            <>
                              <ConfirmDialog
                                destructive
                                title={`Suspend ${row.email}?`}
                                description="Blocks sign-in immediately; all data is retained."
                                confirmLabel="Suspend"
                                onConfirm={() =>
                                  act("status", {
                                    userId: row.id,
                                    status: "suspended",
                                    reason: reasons[`s-${row.id}`] ?? "",
                                  })
                                }
                                trigger={
                                  <Button variant="ghost" size="sm">
                                    Suspend
                                  </Button>
                                }
                              >
                                {reasonInput(`s-${row.id}`)}
                              </ConfirmDialog>
                              <ConfirmDialog
                                destructive
                                title={`Ban ${row.email}?`}
                                description="Blocks sign-in permanently (until reactivated); all data is retained."
                                confirmLabel="Ban"
                                onConfirm={() =>
                                  act("status", {
                                    userId: row.id,
                                    status: "banned",
                                    reason: reasons[`b-${row.id}`] ?? "",
                                  })
                                }
                                trigger={
                                  <Button variant="ghost" size="sm">
                                    Ban
                                  </Button>
                                }
                              >
                                {reasonInput(`b-${row.id}`)}
                              </ConfirmDialog>
                            </>
                          ) : row.status !== "pending_deletion" ? (
                            <ConfirmDialog
                              title={`Reactivate ${row.email}?`}
                              description="Restores sign-in access."
                              confirmLabel="Reactivate"
                              onConfirm={() =>
                                act("status", {
                                  userId: row.id,
                                  status: "active",
                                  reason: reasons[`r-${row.id}`] ?? "",
                                })
                              }
                              trigger={
                                <Button variant="ghost" size="sm">
                                  Reactivate
                                </Button>
                              }
                            >
                              {reasonInput(`r-${row.id}`)}
                            </ConfirmDialog>
                          ) : null}
                          {row.status !== "pending_deletion" && (
                            <ConfirmDialog
                              destructive
                              title={`Delete ${row.email}?`}
                              description="Starts the 30-day recoverable soft delete; PII is permanently removed afterwards."
                              confirmLabel="Delete account"
                              onConfirm={() =>
                                act("delete", {
                                  userId: row.id,
                                  reason: reasons[`d-${row.id}`] ?? "",
                                })
                              }
                              trigger={
                                <Button variant="ghost" size="sm">
                                  Delete
                                </Button>
                              }
                            >
                              {reasonInput(`d-${row.id}`)}
                            </ConfirmDialog>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">
              {total} user{total === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => {
                  const next = Math.max(0, offset - 25);
                  setOffset(next);
                  void load(search, next);
                }}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + 25 >= total}
                onClick={() => {
                  const next = offset + 25;
                  setOffset(next);
                  void load(search, next);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
