"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface AccountSettingsProps {
  email: string;
  marketingEmailsEnabled: boolean;
}

/** Marketing-email preference + self-service account deletion. */
export function AccountSettings({
  email,
  marketingEmailsEnabled,
}: AccountSettingsProps) {
  const [marketing, setMarketing] = useState(marketingEmailsEnabled);

  async function toggleMarketing(enabled: boolean) {
    setMarketing(enabled);
    const res = await fetch("/api/account/marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      setMarketing(!enabled);
      toast.error("Could not save the preference");
    }
  }

  async function deleteAccount() {
    const res = await fetch("/api/account/delete", { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Could not delete the account");
    }
    window.location.href = "/";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border-border flex items-center justify-between gap-3 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Marketing emails</p>
          <p className="text-muted-foreground text-xs">
            Product news and tips to {email}. Transactional emails (receipts,
            security notices) are always sent.
          </p>
        </div>
        <Switch
          checked={marketing}
          onCheckedChange={(v) => void toggleMarketing(v)}
          aria-label="Marketing emails"
        />
      </div>

      <div className="border-destructive/40 flex items-center justify-between gap-3 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Delete account</p>
          <p className="text-muted-foreground text-xs">
            Starts a 30-day recoverable deletion. After that, your leads,
            campaigns, and account data are permanently removed.
          </p>
        </div>
        <ConfirmDialog
          destructive
          title="Delete your account?"
          description="You'll be signed out immediately. Contact support within 30 days to restore; after that your personal data is permanently deleted."
          confirmLabel="Delete my account"
          onConfirm={deleteAccount}
          trigger={
            <Button variant="destructive" size="sm">
              Delete
            </Button>
          }
        />
      </div>
    </div>
  );
}
