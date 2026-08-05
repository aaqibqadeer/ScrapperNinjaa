"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Briefcase,
  ChevronRight,
  Copy,
  HelpCircle,
  LayoutGrid,
  List,
  Megaphone,
  MessageSquare,
  PanelLeft,
  Settings,
  Sparkles,
  User,
  Wallet,
} from "lucide-react";

import { LogoutButton } from "@/components/auth/LogoutButton";
import { BrandMark } from "@/components/shared/BrandMark";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import {
  WorkspaceSwitcher,
  type WorkspaceOption,
} from "@/components/shared/WorkspaceSwitcher";
import { APP_NAME } from "@/config/brand";
import { features } from "@/config/features";
import type { AppNavLink } from "@/components/shared/AppNav";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "sidebar-collapsed";

interface AppSidebarProps {
  links: AppNavLink[];
  homeHref: string;
  workspaces: WorkspaceOption[];
  activeOrgId: string;
  userEmail: string;
}

/** Pick a lucide icon for a nav href (fallback: List). */
function iconForHref(href: string) {
  if (href === "/dashboard") return LayoutGrid;
  if (href === "/profiles") return User;
  if (href === "/settings/filters") return Settings;
  if (href === "/settings/gmail") return MessageSquare;
  if (href === "/leads") return List;
  if (href === "/leads/campaigns") return Megaphone;
  if (href === "/leads/duplicates") return Copy;
  if (href === "/leads/prompts") return Sparkles;
  if (href === "/leads/sessions") return Briefcase;
  if (href === "/settings/billing") return Wallet;
  if (href === "/settings/account") return User;
  if (href === "/settings/organization") return Settings;
  if (href === "/admin") return Settings;
  if (href === "/help") return HelpCircle;
  return List;
}

/** Whether a nav link should render as active for the current pathname. */
function isNavLinkActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/leads") return pathname === "/leads";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Collapsible left sidebar for signed-in pages. Nav links, workspace switcher,
 * theme toggle, and sign-out live here instead of a top header bar.
 */
export function AppSidebar({
  links,
  homeHref,
  workspaces,
  activeOrgId,
  userEmail,
}: AppSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const showLeadsSubtitle =
    features.scraper.enabled && pathname === "/leads";

  return (
    <aside
      className={cn(
        "border-border bg-background flex shrink-0 flex-col border-r transition-[width] duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <div
        className={cn(
          "border-border flex h-14 items-center border-b px-3",
          collapsed ? "justify-center" : "gap-2",
        )}
      >
        <Link
          href={homeHref}
          className="flex items-center gap-2 font-semibold"
          title={APP_NAME}
        >
          <BrandMark />
          {!collapsed && (
            <span className="truncate text-sm">{APP_NAME}</span>
          )}
        </Link>
      </div>

      {!collapsed && showLeadsSubtitle && (
        <div className="border-border border-b px-4 py-3">
          <p className="font-heading text-sm font-semibold">Lead Directory</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
            Every captured business — filter, sort, edit inline, and export.
          </p>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {links.map((link) => {
          const active = isNavLinkActive(link.href, pathname);
          const Icon = iconForHref(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              title={collapsed ? link.label : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                collapsed && "justify-center px-2",
                active
                  ? "bg-secondary text-secondary-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{link.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-border flex flex-col gap-2 border-t p-2">
        {features.multiTenant && workspaces.length > 0 && !collapsed && (
          <WorkspaceSwitcher
            organizations={workspaces}
            activeOrgId={activeOrgId}
          />
        )}
        {!collapsed && (
          <p className="text-muted-foreground truncate px-1 text-xs">
            {userEmail}
          </p>
        )}
        <div
          className={cn(
            "flex items-center gap-1",
            collapsed ? "flex-col" : "justify-between",
          )}
        >
          <ThemeToggle />
          <LogoutButton />
          <button
            type="button"
            onClick={toggleCollapsed}
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-md p-2 transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {mounted && collapsed ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <PanelLeft className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
