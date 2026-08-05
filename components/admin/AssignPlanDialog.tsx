"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface PlanOption {
  id: string;
  slug: string;
  name: string;
}

interface AssignPlanDialogProps {
  organizationId: string;
  /** Plans the super admin can assign (typically the active plans). */
  plans: PlanOption[];
  /** Currently-assigned plan id, pre-selected in the picker when known. */
  currentPlanId?: string | null;
  /** Label for who/what is being assigned (org or user email). */
  targetLabel: string;
  /** Called after a successful assignment (e.g. to reload the table). */
  onAssigned?: () => void;
  triggerLabel?: string;
}

/**
 * Super-admin "Assign plan" dialog — force-sets an org's plan with no Stripe
 * (POST /api/admin/subscriptions/assign). Reused by the users and subscriptions
 * tables (§9).
 */
export function AssignPlanDialog({
  organizationId,
  plans,
  currentPlanId,
  targetLabel,
  onAssigned,
  triggerLabel = "Assign plan",
}: AssignPlanDialogProps) {
  const [planId, setPlanId] = useState<string>(
    currentPlanId ?? plans[0]?.id ?? "",
  );

  async function assign(): Promise<void> {
    if (!planId) throw new Error("Pick a plan first");
    const res = await fetch("/api/admin/subscriptions/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, planId }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Could not assign plan");
    const plan = plans.find((p) => p.id === planId);
    toast.success(`Assigned "${plan?.name ?? "plan"}" to ${targetLabel}`);
    onAssigned?.();
  }

  return (
    <ConfirmDialog
      title="Assign plan"
      description={`Force-set ${targetLabel}'s plan. No payment is taken — this drops them onto the plan immediately.`}
      confirmLabel="Assign plan"
      onConfirm={assign}
      trigger={
        <Button variant="ghost" size="sm" disabled={plans.length === 0}>
          {triggerLabel}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`assign-plan-${organizationId}`}>Plan</Label>
        <Select
          id={`assign-plan-${organizationId}`}
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </Select>
      </div>
    </ConfirmDialog>
  );
}
