"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export interface AdminNavProps {
  isSuperAdmin: boolean;
  isSupportAdmin: boolean;
  paymentsEnabled: boolean;
  scraperEnabled: boolean;
}

/**
 * Tab nav for the platform admin panel. Support admins see the view/refund
 * surface (Users, Subscriptions); everything else is super-admin. Hiding tabs
 * here is cosmetic — every page and route enforces its own guard.
 */
export function AdminNav({
  isSuperAdmin,
  isSupportAdmin,
  paymentsEnabled,
  scraperEnabled,
}: AdminNavProps) {
  const pathname = usePathname();
  const staff = isSuperAdmin || isSupportAdmin;

  const links = [
    { href: "/admin", label: "Overview", show: staff },
    { href: "/admin/users", label: "Users", show: staff },
    {
      href: "/admin/subscriptions",
      label: "Subscriptions",
      show: staff && paymentsEnabled,
    },
    { href: "/admin/plans", label: "Plans", show: isSuperAdmin },
    {
      href: "/admin/source-packs",
      label: "Source packs",
      show: isSuperAdmin && scraperEnabled,
    },
    { href: "/admin/audit", label: "Audit log", show: isSuperAdmin },
    { href: "/admin/settings", label: "Settings", show: isSuperAdmin },
  ].filter((link) => link.show);

  return (
    <nav className="flex flex-wrap gap-1 border-b pb-2">
      {links.map((link) => {
        const active =
          link.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-secondary text-secondary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
