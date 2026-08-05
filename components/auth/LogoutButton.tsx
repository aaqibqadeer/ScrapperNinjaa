"use client";

import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LogoutButtonProps {
  compact?: boolean;
  className?: string;
}

/** Signs the user out (clears the session) and redirects to login. */
export function LogoutButton({ compact = false, className }: LogoutButtonProps) {
  async function onClick() {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { redirect?: string };
    window.location.assign(data.redirect ?? "/login");
  }

  if (compact) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClick}
        className={className}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn("w-full justify-center", className)}
    >
      <LogOut className="size-4" aria-hidden="true" />
      Sign out
    </Button>
  );
}
