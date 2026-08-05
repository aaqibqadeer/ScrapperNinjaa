import Link from "next/link";

import { BrandMark } from "@/components/shared/BrandMark";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/config/brand";

interface SiteHeaderProps {
  /** When true, swap the auth buttons for a single "Leads" link. */
  signedIn?: boolean;
}

/** In-page anchors for the marketing sections rendered on the landing page. */
const MARKETING_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
] as const;

/**
 * Public marketing header for the landing page. Sticky, translucent, and
 * theme-aware. Shows Log in / Get started to visitors, or a Leads link once
 * a session exists (resolved by the page and passed as `signedIn`).
 */
export function SiteHeader({ signedIn = false }: SiteHeaderProps) {
  return (
    <header className="border-border bg-background/80 sticky top-0 z-40 w-full border-b backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <BrandMark />
          <span>{APP_NAME}</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          {MARKETING_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/leads">Leads</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
