# Current State

> **Read this first, every session** (CLAUDE.md §11). Living snapshot — overwritten, not appended.

_Last updated: 2026-08-05 — **ScrapperNinja-only fork**: removed ApplyNinjaa job-application surface (profiles, applications, filters, Gmail, apply extension product). `NEXT_PUBLIC_PRODUCT=scrapperninja` only._

## What this repo is

**ScrapperNinja** — lead-gen SaaS forked from ninjakit: capture local businesses via Chrome extension, enrich/score in a shared Lead Directory, export CSVs. MongoDB adapter only; DeepSeek for AI; Stripe plans; custom JWT + Google OAuth + extension Bearer auth.

## Product flags (standard `.env.local` set)

- `NEXT_PUBLIC_PRODUCT=scrapperninja` (required)
- `NEXT_PUBLIC_FEATURE_SCRAPER=1` (+ optional enrichment / offerLines / genericExtractor)
- Auth: email-password + Google OAuth; payments + annual billing; admin; cookie banner; DeepSeek AI
- `multiTenant` off → silent default org per user

## What's built

- **Lead Directory** `/leads` — table, views, campaigns, custom fields, CSV export, detail drawer, duplicates, prompts, capture sessions
- **Ingest + scrape APIs** — Bearer `/api/leads/ingest`, `/api/scrape/*`, capture sessions, jobs runner (in-process `after()`), duplicates merge
- **Extension** — `extension/products/scrapperninja` → `npm run build:extension` → `extension/dist/scrapperninja`
- **Platform admin** — users, subscriptions, plans, source packs, audit, settings
- **Seed** — demo leads/campaigns/views/source packs/offer prompts + 4 plans (lead/campaign/AI limits)

## Capture field mapping (2026-08-05 fix)

Adapters map a field only when the text passes a shape check
(`scrapers/text.ts`); selector packs are appended to — not replaced by — the
bundled fallbacks. Maps fast mode now also yields phone/website/hours/lat-lng;
deep mode verifies the panel belongs to the clicked result. Tier-d (Instagram,
LinkedIn, …) captures via `scrapers/page-meta.ts` (Open Graph + JSON-LD +
mailto/tel/link-in-bio). AI rescue fills gaps only, never overwrites.

## Verification

- `npm run typecheck`, `npm run lint`, `npm test` pass with `NEXT_PUBLIC_PRODUCT=scrapperninja`
  — except **2 pre-existing failures** in `lib/leads/columns.test.ts` (the
  editable-column assertions drifted from the catalog; unrelated to capture)
- `npm run build:extension` produces `extension/dist/scrapperninja`
- `next build` with `SKIP_ENV_VALIDATION=1`

## Deferred / rough edges

- Capture parsers are unit-tested (`scrapers/text.test.ts`); the DOM adapters
  themselves are still not browser-verified in CI, nor are Phase 3 jobs
- Orgs seeded before 2026-08-05 keep the old `google-maps` source pack (seed is
  create-only). Harmless — the bundled fallbacks now cover it — but re-seeding
  or editing it in `/admin/source-packs` restores full selector coverage.
- No automated E2E — manual QA in `docs/guides/testing-guide.md` (ScrapperNinja cases)
