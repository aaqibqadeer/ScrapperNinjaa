import Link from "next/link";

import { Button } from "@/components/ui/button";

export interface UpgradeNoticeProps {
  /** What the user was trying to do, e.g. "Scan your inbox". */
  title: string;
  /** Why it's unavailable and what upgrading unlocks. */
  description: string;
  /**
   * Plan name that includes the feature, when known. Read from the plans
   * table by the caller — never hardcode a plan name (§15).
   */
  requiredPlan?: string | null;
  /** Rendered instead of the default "See plans" button when provided. */
  action?: React.ReactNode;
}

/**
 * The one upsell surface for a plan-locked feature. Server-side guards
 * (`requireFeature` / `enforceLeadLimit`) are what actually enforce
 * entitlements — this is the graceful "not rendered" half of §2's rule that a
 * gated feature must never become a broken page or a thrown error.
 */
export function UpgradeNotice({
  title,
  description,
  requiredPlan,
  action,
}: UpgradeNoticeProps) {
  return (
    <div className="border-border bg-muted/30 flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {description}
          {requiredPlan ? ` Available on ${requiredPlan} and above.` : null}
        </p>
      </div>
      {action ?? (
        <Button asChild size="sm">
          <Link href="/settings/billing">See plans</Link>
        </Button>
      )}
    </div>
  );
}
