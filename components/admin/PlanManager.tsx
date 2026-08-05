"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { RowNumberCell } from "@/components/shared/RowNumberCell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Plan } from "@/lib/db/schema";

import { PlanFormDialog } from "./PlanFormDialog";

export interface PlanManagerProps {
  plans: Plan[];
  annualBilling: boolean;
  paymentsEnabled: boolean;
}

function money(cents: number | null | undefined): string {
  return cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;
}

/** Super-admin plan CRUD table (§15). */
export function PlanManager({
  plans,
  annualBilling,
  paymentsEnabled,
}: PlanManagerProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleActive(plan: Plan) {
    setBusyId(plan.id);
    try {
      const res = await fetch("/api/admin/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: plan.id, isActive: !plan.isActive }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not update the plan");
        return;
      }
      toast.success(plan.isActive ? "Plan deactivated" : "Plan activated");
      window.location.reload();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function deletePlan(plan: Plan) {
    const res = await fetch("/api/admin/plans", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: plan.id }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Could not delete the plan");
    toast.success("Plan deleted");
    window.location.reload();
  }

  const columns: DataTableColumn<Plan>[] = [
    {
      key: "num",
      header: "#",
      className: "w-10 text-right",
      cell: (_p, index) => <RowNumberCell index={index} />,
    },
    {
      key: "name",
      header: "Name",
      cell: (p) => (
        <span className="font-medium">
          {p.name}
          {!p.isActive && (
            <Badge variant="outline" className="ml-2">
              inactive
            </Badge>
          )}
        </span>
      ),
    },
    { key: "monthly", header: "Monthly", cell: (p) => money(p.priceMonthly) },
    ...(annualBilling
      ? [
          {
            key: "annual",
            header: "Annual",
            cell: (p: Plan) => money(p.priceAnnual),
          } satisfies DataTableColumn<Plan>,
        ]
      : []),
    { key: "sort", header: "Order", cell: (p) => p.sortOrder },
    {
      key: "active",
      header: "Active",
      cell: (p) => (
        <Switch
          checked={p.isActive}
          disabled={busyId === p.id}
          onCheckedChange={() => toggleActive(p)}
          aria-label={`Toggle ${p.name}`}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <PlanFormDialog
            annualBilling={annualBilling}
            plan={p}
            trigger={
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            }
          />
          <ConfirmDialog
            destructive
            title="Delete plan"
            description={`Delete "${p.name}"? This can't be undone.`}
            confirmLabel="Delete"
            onConfirm={() => deletePlan(p)}
            trigger={
              <Button variant="ghost" size="sm">
                Delete
              </Button>
            }
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          {paymentsEnabled
            ? "Editing a price mints a new Stripe Price (the old one is archived)."
            : "Payments is off — plans are saved without Stripe prices."}
        </p>
        <PlanFormDialog
          annualBilling={annualBilling}
          trigger={<Button size="sm">Add plan</Button>}
        />
      </div>
      <DataTable
        rows={plans}
        getRowKey={(p) => p.id}
        columns={columns}
        empty={
          <EmptyState
            title="No plans yet."
            description="Create your first pricing plan."
            action={
              <PlanFormDialog
                annualBilling={annualBilling}
                trigger={<Button size="sm">Add plan</Button>}
              />
            }
          />
        }
      />
    </div>
  );
}
