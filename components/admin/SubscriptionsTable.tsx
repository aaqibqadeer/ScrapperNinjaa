"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  AssignPlanDialog,
  type PlanOption,
} from "@/components/admin/AssignPlanDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { RowNumberCell } from "@/components/shared/RowNumberCell";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format/datetime";

export interface SubscriptionRow {
  id: string;
  organizationId: string;
  orgName: string;
  planId: string | null;
  planName: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId: string | null;
  chargeId: string | null;
  /** Latest charge total, integer minor units (cents). */
  chargeAmount: number | null;
  currency: string | null;
}

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  active: "default",
  trialing: "secondary",
  past_due: "destructive",
  canceled: "outline",
  incomplete: "secondary",
};

interface SubscriptionsTableProps {
  rows: SubscriptionRow[];
  /** Cancel + assign-plan are super-admin-only; support admins see refunds only. */
  isSuperAdmin: boolean;
  /** Assignable plans (super-admin "Change plan"); empty hides the action. */
  plans?: PlanOption[];
}

/** Cross-user subscription list with refund (staff) + cancel/assign (super-admin). */
export function SubscriptionsTable({
  rows,
  isSuperAdmin,
  plans = [],
}: SubscriptionsTableProps) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  function amountFor(row: SubscriptionRow): string {
    return (
      amounts[row.id] ??
      (row.chargeAmount != null ? (row.chargeAmount / 100).toFixed(2) : "")
    );
  }

  async function cancel(row: SubscriptionRow) {
    const res = await fetch("/api/admin/subscriptions/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscriptionId: row.id,
        stripeSubscriptionId: row.stripeSubscriptionId,
        reason: reasons[`cancel-${row.id}`] ?? "",
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Could not cancel");
    toast.success(`Cancelled ${row.orgName}'s subscription`);
    window.location.reload();
  }

  async function refund(row: SubscriptionRow) {
    if (!row.chargeId) throw new Error("No charge to refund");
    const raw = amountFor(row);
    const amount = raw ? Math.round(parseFloat(raw) * 100) : undefined;
    const res = await fetch("/api/admin/subscriptions/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chargeId: row.chargeId,
        amount,
        reason: reasons[`refund-${row.id}`] ?? "",
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Could not refund");
    toast.success("Refund issued");
    window.location.reload();
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

  const columns: DataTableColumn<SubscriptionRow>[] = [
    {
      key: "num",
      header: "#",
      className: "w-10 text-right",
      cell: (_r, index) => <RowNumberCell index={index} />,
    },
    { key: "org", header: "Organization", cell: (r) => r.orgName },
    { key: "plan", header: "Plan", cell: (r) => r.planName },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>
          {r.status}
          {r.cancelAtPeriodEnd ? " (ending)" : ""}
        </Badge>
      ),
    },
    {
      key: "period",
      header: "Renews",
      cell: (r) => formatDate(r.currentPeriodEnd),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {isSuperAdmin && plans.length > 0 && (
            <AssignPlanDialog
              organizationId={r.organizationId}
              plans={plans}
              currentPlanId={r.planId}
              targetLabel={r.orgName}
              triggerLabel="Change plan"
              onAssigned={() => window.location.reload()}
            />
          )}
          {isSuperAdmin && (
            <ConfirmDialog
              destructive
              title="Cancel subscription"
              description={`Cancel ${r.orgName}'s "${r.planName}" subscription? They drop to Free at period end.`}
              confirmLabel="Cancel subscription"
              cancelLabel="Keep it"
              onConfirm={() => cancel(r)}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={r.status === "canceled"}
                >
                  Cancel
                </Button>
              }
            >
              {reasonInput(`cancel-${r.id}`)}
            </ConfirmDialog>
          )}
          {r.chargeId ? (
            <ConfirmDialog
              destructive
              title="Refund charge"
              description="Amount is pre-filled to the full charge; edit it for a partial refund."
              confirmLabel="Issue refund"
              onConfirm={() => refund(r)}
              trigger={
                <Button variant="ghost" size="sm">
                  Refund
                </Button>
              }
            >
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`refund-${r.id}`}>Amount ($)</Label>
                  <Input
                    id={`refund-${r.id}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={amountFor(r)}
                    onChange={(e) =>
                      setAmounts((prev) => ({
                        ...prev,
                        [r.id]: e.target.value,
                      }))
                    }
                  />
                </div>
                {reasonInput(`refund-${r.id}`)}
              </div>
            </ConfirmDialog>
          ) : (
            <span className="text-muted-foreground px-2 text-sm">—</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      getRowKey={(r) => r.id}
      columns={columns}
      empty={<EmptyState title="No subscriptions yet." />}
    />
  );
}
