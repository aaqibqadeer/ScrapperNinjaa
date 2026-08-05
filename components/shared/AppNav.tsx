"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export interface AppNavLink {
  href: string;
  label: string;
}

interface AppNavProps {
  links: AppNavLink[];
  className?: string;
}

/**
 * Horizontal in-app nav with active-route highlighting. Client-only so it can
 * read `usePathname`; the link set is computed on the server (from flags + the
 * viewer's role) and passed in as plain data — see `AppShell`.
 */
export function AppNav({ links, className }: AppNavProps) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex items-center gap-1", className)}>
      {links.map((link) => {
        const active =
          link.href === "/leads"
            ? pathname === "/leads"
            : pathname === link.href ||
              pathname.startsWith(`${link.href}/`);
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
