"use client";

import { useState } from "react";

import { DEFAULT_AUTHED_PATH } from "@/lib/auth/constants";
import { Button } from "@/components/ui/button";

/** Accept the invitation identified by `token`, then land on the Lead Directory. */
export function AcceptInviteButton({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function accept() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/org/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as { error?: string; redirect?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not accept invitation");
        return;
      }
      window.location.assign(data.redirect ?? DEFAULT_AUTHED_PATH);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button onClick={accept} disabled={loading}>
        {loading ? "Accepting…" : "Accept invitation"}
      </Button>
    </div>
  );
}
