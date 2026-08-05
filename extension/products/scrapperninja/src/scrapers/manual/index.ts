/**
 * Manual adapter — tier "d". Automation on these sites (LinkedIn, Instagram,
 * Facebook, …) is a ban risk, so there is NO auto harvest at all: `harvestList`
 * always returns nothing and there is no `scroll`. The only way to capture is a
 * single-page "Capture this page" click, which yields one record from the
 * visible page.
 *
 * These pages render everything through obfuscated class names, so selector
 * scraping gets nothing from them — but they publish their own metadata for
 * search engines. `readPageMeta` reads that (Open Graph, JSON-LD, `mailto:` /
 * `tel:` links, the link-in-bio) to fill name, description, phone, website,
 * emails, socials and address; `rawSnippet` is kept so the server's AI rescue
 * can fill whatever is left (category above all).
 *
 * Tier "d" is ALSO enforced in the service worker (it refuses to run the
 * capture loop) — this adapter is the second line of that same rule, so even a
 * bug in the orchestrator cannot auto-scrape a tier-d site.
 */

import { visibleText } from "../dom";
import { readPageMeta } from "../page-meta";
import type { HarvestContext, RawRecord, SourceAdapter } from "../types";

const TIER_D_HOSTS = [
  "linkedin.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
];

/** How much page text is kept for the server-side rescue pass. */
const SNIPPET_LIMIT = 4000;

export const manualAdapter: SourceAdapter = {
  id: "manual",
  automationTier: "d",
  supportsDeep: false,

  match(url: string): boolean {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return TIER_D_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
      return false;
    }
  },

  async harvestList(): Promise<RawRecord[]> {
    // Hard rule: tier "d" never auto-harvests.
    return [];
  },

  async capturePage(ctx: HarvestContext): Promise<RawRecord> {
    const meta = readPageMeta(ctx.sourceUrl || location.href);
    // The profile header carries the bio/category; `main` misses it on some
    // layouts, so fall back to the body.
    const snippet = visibleText(
      document.querySelector("main") ?? document.body ?? document.documentElement,
      SNIPPET_LIMIT,
    );

    const record: RawRecord = {
      businessName: meta.businessName,
      category: meta.category,
      description: meta.description,
      phone: meta.phone,
      website: meta.website,
      emails: meta.emails,
      socials: meta.socials,
      ownerName: meta.ownerName,
      address: meta.address ?? undefined,
      lat: meta.lat,
      lng: meta.lng,
      rawSnippet: snippet,
      sourceUrl: ctx.sourceUrl || location.href,
      ref: location.href,
    };

    // Flag for AI rescue unless the page already gave up the fields that matter.
    const thin =
      !record.businessName ||
      !record.category ||
      (!record.phone && !record.website && !record.address?.raw);
    if (thin) record.parseIssues = ["needs_ai_extract"];
    return record;
  },
};
