/**
 * config/features.ts — single source of truth for feature flags
 * (CLAUDE.md §1 config-driven, §2 core).
 *
 * Flags are resolved ONCE, at module load, from environment variables. App code
 * imports `features` and checks a flag — it never reads `process.env` directly,
 * and never hardcodes an optional feature as always-on.
 *
 * Resolution convention (per the agreed shape): a flag is ON when its env var is
 * present and non-empty — `!!process.env.X`, not a string comparison. To enable,
 * set the var (e.g. `=1`); to disable, omit it or leave it empty.
 *   ⚠︎ Because resolution is `!!`, ANY non-empty value enables the flag —
 *   including "0" or "false". Presence = on. Don't set a flag to "false"
 *   expecting it off; remove the line instead.
 *
 * Naming: toggle vars use the `NEXT_PUBLIC_FEATURE_` prefix so this registry
 * resolves identically on the server and in the client bundle (Next.js inlines
 * `NEXT_PUBLIC_` vars at build time). The provider *secrets* a flag unlocks
 * (API keys, client secrets) stay server-only and are validated conditionally
 * in `config/env.schema.ts`.
 *
 * Every future phase that adds a flag must also update
 * `docs/architecture/feature-flags.md` (§7).
 */

/** AI providers that can be enabled via the `aiProviders` array flag. */
export const AI_PROVIDERS = ["anthropic", "openai", "deepseek"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AuthFeatureFlags {
  /** Classic email + password sign-in. */
  emailPassword: boolean;
  /** Passwordless email magic-link sign-in. */
  magicLink: boolean;
  /** OAuth providers. */
  oauth: {
    google: boolean;
    github: boolean;
    linkedin: boolean;
  };
}

export interface PaymentsFeatureFlags {
  /** Master switch — Stripe checkout/portal/webhook + billing UI. */
  enabled: boolean;
  /**
   * Annual billing cadence. When on, plans may set `priceAnnual` +
   * `annualDiscountPercent` and the UI offers a monthly/annual toggle; when off,
   * only `priceMonthly` is used. Toggling requires no schema change (§15).
   */
  annualBilling: boolean;
}

export interface ScraperFeatureFlags {
  /** Master switch — lead scraping product (ScrapperNinja). */
  enabled: boolean;
  /** Enrichment pass over scraped leads (Phase 3). */
  enrichment: boolean;
  /** Per-lead offer-line generation (Phase 3). */
  offerLines: boolean;
  /** Generic (non-site-specific) extractor (Phase 2). */
  genericExtractor: boolean;
}

export interface Features {
  auth: AuthFeatureFlags;
  /** Subscription / one-off billing (Stripe). */
  payments: PaymentsFeatureFlags;
  /** Lead-scraping product surface (ScrapperNinja). */
  scraper: ScraperFeatureFlags;
  /** File storage. */
  storage: boolean;
  /** SMS phone-number verification (Twilio Verify). */
  phoneVerification: boolean;
  /** Admin panel routes/UI. */
  admin: boolean;
  /** Cookie-consent banner (accept/reject, choice stored in a cookie). */
  cookieBanner: boolean;
  /** Enabled AI providers; empty array means AI is off. */
  aiProviders: AiProvider[];
  /**
   * Multi-tenant UI/behavior (org switching, invites, multiple orgs per user).
   * The schema is ALWAYS multi-tenant (§1.3); when this is off, users get one
   * silent default org and no org-management UI — never a schema that skips the
   * org table.
   */
  multiTenant: boolean;
}

/** Parse the comma-separated `NEXT_PUBLIC_FEATURE_AI_PROVIDERS` list. */
function resolveAiProviders(): AiProvider[] {
  const raw = process.env.NEXT_PUBLIC_FEATURE_AI_PROVIDERS ?? "";
  const known = new Set<string>(AI_PROVIDERS);
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is AiProvider => known.has(entry));
}

export const features: Features = {
  auth: {
    emailPassword: !!process.env.NEXT_PUBLIC_FEATURE_AUTH_EMAIL_PASSWORD,
    magicLink: !!process.env.NEXT_PUBLIC_FEATURE_AUTH_MAGIC_LINK,
    oauth: {
      google: !!process.env.NEXT_PUBLIC_FEATURE_AUTH_OAUTH_GOOGLE,
      github: !!process.env.NEXT_PUBLIC_FEATURE_AUTH_OAUTH_GITHUB,
      linkedin: !!process.env.NEXT_PUBLIC_FEATURE_AUTH_OAUTH_LINKEDIN,
    },
  },
  payments: {
    enabled: !!process.env.NEXT_PUBLIC_FEATURE_PAYMENTS,
    annualBilling: !!process.env.NEXT_PUBLIC_FEATURE_PAYMENTS_ANNUAL_BILLING,
  },
  scraper: {
    enabled: !!process.env.NEXT_PUBLIC_FEATURE_SCRAPER,
    enrichment: !!process.env.NEXT_PUBLIC_FEATURE_SCRAPER_ENRICHMENT,
    offerLines: !!process.env.NEXT_PUBLIC_FEATURE_SCRAPER_OFFER_LINES,
    genericExtractor: !!process.env.NEXT_PUBLIC_FEATURE_SCRAPER_GENERIC_EXTRACTOR,
  },
  storage: !!process.env.NEXT_PUBLIC_FEATURE_STORAGE,
  phoneVerification: !!process.env.NEXT_PUBLIC_FEATURE_PHONE_VERIFICATION,
  admin: !!process.env.NEXT_PUBLIC_FEATURE_ADMIN,
  cookieBanner: !!process.env.NEXT_PUBLIC_FEATURE_COOKIE_BANNER,
  aiProviders: resolveAiProviders(),
  multiTenant: !!process.env.NEXT_PUBLIC_FEATURE_MULTI_TENANT,
};

export type FeatureFlags = typeof features;
export type FeatureName = keyof FeatureFlags;

/** True when at least one auth method is enabled. */
export const isAnyAuthEnabled: boolean =
  features.auth.emailPassword ||
  features.auth.magicLink ||
  features.auth.oauth.google ||
  features.auth.oauth.github ||
  features.auth.oauth.linkedin;

/** True when at least one AI provider is enabled. */
export const isAnyAiEnabled: boolean = features.aiProviders.length > 0;
