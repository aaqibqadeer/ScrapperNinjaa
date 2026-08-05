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

## Verification

- `npm run typecheck`, `npm run lint`, `npm test` pass with `NEXT_PUBLIC_PRODUCT=scrapperninja`
- `npm run build:extension` produces `extension/dist/scrapperninja`
- `next build` with `SKIP_ENV_VALIDATION=1`

## Deferred / rough edges

- Extension DOM harvesting and Phase 3 jobs not browser-verified in CI
- No automated E2E — manual QA in `docs/guides/testing-guide.md` (ScrapperNinja cases)
