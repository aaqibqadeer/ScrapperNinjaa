# Decisions

> Non-obvious decisions and _why_ (CLAUDE.md §11). Short entries, dated, **newest
> at the top** — only what a future agent would otherwise re-derive or get wrong.
> Recent phases stay here; older entries live in
> [`decisions-archive.md`](./decisions-archive.md). Keep this file small.

## 2026-08-05 — ScrapperNinja-only fork (drop ApplyNinjaa)

This repo is **ScrapperNinja-only**, not a two-product deployment:

- Removed `jobApplications`, `gmail` flags and all Apply routes/libs (profiles, applications, filters, Gmail, resume AI tasks, `extension/products/applyninja`).
- `NEXT_PUBLIC_PRODUCT` valid value is **`scrapperninja` only** (`config/products.ts`).
- Plan limits use scraper keys only: `leadLimit`, `campaignLimit`, `aiCallsPerMonth`, `enrichment`, `offerLines`, `dataExport`.
- Extension release tags: `ext-scrap-v*` (not `ext-v*` / apply matrix).
- Deleted DB collections' adapter methods (profiles, applications, job_filters, gmail_scans) per §1.5 — data in old collections is orphaned, not migrated.

## 2026-08-03 — ScrapperNinja Phase 3 UI (jobs, duplicates, prompts)

UI built **against contracts** ahead of the Phase 3 backend (owned by another
agent). Choices a future agent shouldn't re-derive:

- **Jobs client is UI-only for now:** `components/jobs/{types,api}.ts` hold the
  client `Job`/`JobType`/estimate shapes + thin `fetch` wrappers. No `lib/jobs`
  yet. Every wrapper returns a status-carrying `JobsResult<T>` so callers toast
  on 404 (not built) / 402 (AI cap) instead of throwing — the whole Phase 3 UI
  degrades gracefully when its API is absent. When the backend lands, align/
  re-export those types from `lib/jobs`.
- **Stale = resumable:** a job is "stale" when `running` + `startedAt` >10m ago
  **and** `updatedAt` >10m ago (`isJobStale`). `JobProgress` self-polls
  `GET /api/jobs/:id` every 2s while active unless `selfPoll={false}`.
- **Two preset chips became query-layer params, not `f.` filters:**
  `notEnriched` (`enrichment_status != "done"`, so it also catches null) and
  `missingOfferLine` (`offer_line` null/empty) — the query layer has no generic
  "not equal" / "empty text" operator, and null-valued leads are the common case.
  Added a filterable `enrichmentStatus` enum **column** too (dropdown/sort). The
  "possible duplicates" chip is a link to `/leads/duplicates` with a pending
  count badge (`GET /api/duplicates?status=pending` → `candidates.length`).
- **`offerLineEditedAt` is stamped in `service.updateLead`** whenever `offerLine`
  changes to a new value — so the offer AI pass's `skipEdited` can avoid
  clobbering hand-written copy. (The adapter already mapped the field.)
- **Duplicate merge contract:** `fieldChoices` maps a lead **field name → the
  winning lead's id**; `primaryId` is the survivor. Default = leadA for both.

## 2026-08-03 — ScrapperNinja Phase 2 dashboard + admin UI

Wired the capture pipeline into the web app (server APIs already existed). Calls
a future agent shouldn't re-derive:

- **Selector packs are edited from a platform admin page** (`/admin/source-packs`,
  `SourcePacksManager`), gated `features.scraper.enabled && isSuperAdmin` — packs
  are platform-level (no `organization_id`), like plans (§15). `AdminNav` gained a
  `scraperEnabled` prop (passed from the layout) so the tab hides in ApplyNinjaa
  forks. Selectors are edited as a JSON textarea, validated client-side to a flat
  `Record<string,string>` before POST/PATCH.
- **Needs-review count is fetched org-wide, not from the current filter:** the
  `/leads` chip badge + "Rescue N records" button call
  `GET /api/leads?status=needs_review&pageSize=1` and read `total`, refreshed on
  every table reload (keyed on the same `nonce`). The Rescue button posts
  `{ limit: 50 }`; **402 `AI_CAP_REACHED` is handled inline** as an upgrade toast
  (never a thrown error), matching `capReached` in the 200 body.
- **Tier-d enforcement stays server/worker-side** (see the client entry below);
  the admin pack UI sets `automationTier` per pack but does not re-implement the
  guard — the extension owns it.
- **Lead provenance is a thin read route:** `GET /api/leads/[id]/sources` →
  `listLeadSources` verifies the lead belongs to the org via `getLeadById` first,
  then returns `listLeadSourcesForLead`. The drawer shows all `lead_sources` rows
  in addition to the lead's primary source, so a future merged lead shows every
  capture. Capture sessions render read-only (`/leads/sessions`) — no edit path.

## 2026-08-02 — ScrapperNinja Phase 2 CLIENT side (multi-product extension + capture)

Built the extension half (P1 multi-product layout + the ScrapperNinja capture
extension). Calls a future agent shouldn't re-derive:

- **Multi-product build via one `PRODUCT`-parameterised `vite.config.ts`** with
  `root` set to `products/<product>/` so `popup.html` lands at the dist root.
  Content scripts can't be ES modules and rollup can't mix formats, so
  ScrapperNinja gets a **second IIFE pass** (`vite.content.config.ts`,
  `emptyOutDir:false`) chained in `build.mjs`. `extension/shared/` holds code both
  products import; ApplyNinjaa was `git mv`'d intact (behaviour unchanged).
- **Root `build:extension` no longer installs** extension deps (it's now
  `PRODUCT=… build`), so `ci.yml` gained an explicit `npm --prefix extension ci`
  step — the extension is a separate package, not an npm workspace.
- **Tier "d" is enforced in the service worker**, not just the popup: `handleStart`
  refuses to run the capture loop on a tier-d adapter; the `manual` adapter also
  returns `[]` from `harvestList`. Two independent guards for the same rule.
- **Wire-contract alignment (verified against the server Zod schemas):** ingest
  carries `sourceType`/`campaignId`/`sessionId` at the **batch** level (not per
  record), `businessName` is required — so `sync.ts` groups by those three and
  fills a `businessName` fallback (first snippet line) for generic/manual
  records. Selector-pack `sourceId` is hyphenated ("google-maps") vs the
  underscored source type, so the worker normalises `_`→`-` before matching.
  Session terminal status is `canceled` (not "stopped").

## 2026-08-02 — ScrapperNinja Phase 2 SERVER side (ingest, rescue, extract, packs)

Built the server half of the capture extension (no extension UI touched — that's
a separate, later slice). Notable calls a future agent shouldn't re-derive:

- **`source_packs` is platform-level** (no `organization_id`), like `plans` —
  selectors serve every tenant. Unique on `source_id` (one pack per source);
  admin CRUD is **`authorizeApi({ superAdmin: true })`**, never `requireRole`.
- **Task→provider routing** lives in `lib/ai/routing.ts` (`providerForTask`), all
  8 pipeline tasks → DeepSeek today. It imports only `config/features` (never
  `env.schema`) so the pure scrape modules + their vitest stay DB/env-free.
- **Test-safety pattern:** `lib/scrape/generate.ts` imports the `ai()` accessor
  **lazily** (`await import("@/lib/ai")`) so `parseRescueResponse` /
  `pickBestRepeatedGroup` are unit-testable without loading `env.schema`.
- **Inline rescue is best-effort:** ingest saves leads first, then rescues ≤25
  flagged records; hitting the AI cap (`UsageLimitError`) or a bad snippet just
  leaves the record in the review queue — it never fails the ingest.
- **Campaign `lead_count`** bumps only for **newly-created** leads, so a re-synced
  batch (idempotent upsert) never inflates it.
- New `AiCallKind`s: `lead_rescue`, `scrape_extract`. Capture sessions auto-stamp
  `ended_at` when PATCHed to a terminal status.

## 2026-08-01 — ScrapperNinja Phase 1 (foundation) + the 20 locked decisions

Phase 1 built the schema, Lead Directory (`/leads`), query/service/CSV layer,
API routes, vitest suite, and demo seed. The 20 decisions locked in
`docs/prompts/scrapperninja-execution-plan.md` (summarized — a future agent must
not re-derive these):

- **Products & scope.** Old product flag-gated **off** but code kept (1); leads
  are **org-scoped** (team shares one directory) and lead↔campaign is
  **many-to-many** (20); workflow **stops at export** — statuses are `new`/
  `needs_review`/`ready`/`exported`/`junk`/`archived`, no CRM stages (17).
- **Lead table full-power in Phase 1** (4): column show/hide + reorder,
  per-column filters, sort, offset pagination, bulk actions, inline edit, CSV
  export, **saved views**, and **user-defined custom columns**. Scale target
  **≤100k leads/org** → offset pagination + Mongo indexes, **in-process** job
  runner, no Redis (3).
- **Two review surfaces** (16): parse issues inline in the main table (status
  filter); duplicates get their own page. **Dedupe never auto-merges** —
  everything goes to a review queue (8).
- **Export is CSV only** (19), server-streamed, **visible columns × filtered
  rows**; with formula-injection guarding in `lib/leads/csv.ts`.
- **Capture (Phase 2)** has a **Fast / Deep** popup toggle (5) and uses
  **server-pushed selector packs** — selectors live in the DB, the extension
  fetches them per run (7). **Named adapters + a generic AI extractor** cover the
  long tail (12); Phase 2 ships Google Maps deep + the generic extractor +
  manual single-page capture, **not Yelp** (13). SoS registries (Tier C) are
  deferred — **CSV import** covers them in Phase 1 (14); LinkedIn/IG/FB (Tier D)
  stay **manual-only, `automationTier` enforced in code** (15).
- **AI (Phase 3).** **DeepSeek for every AI task**, routing in one config file so
  tasks can be re-pointed (18). DeepSeek parse-**rescue** fires on the backend at
  sync time (6). **Score is AI-judged with stored reasoning**, not rule-based
  (10). Enrichment = crawl + tech stack; **PageSpeed optional** behind
  `PAGESPEED_API_KEY` (9).
- **Testing (11):** **Vitest** added in Phase 1 and `scripts/seed-test.ts`
  implemented for real (wipe + reseed the guarded test DB). Marketing landing
  page rewritten in Phase 1 (2).

Phase-1 specifics worth remembering: capture idempotency is a **unique-sparse
`(organization_id, client_capture_id)`** index (retries/CSV re-imports upsert,
never duplicate); the query layer excludes `junk` **and** soft-deleted
(`deleted_at`) rows by default; `vitest.config.mts` is `.mts` on purpose so the
`import.meta.url` `@/` alias resolves as ESM; demo seed is idempotent on the
`seed-demo-` `clientCaptureId` prefix.

## 2026-08-01 — P0: product identity registry (two products, one repo)

- **`NEXT_PUBLIC_PRODUCT` is always required** (`applyninja`|`scrapperninja`).
  No silent default — shipping the wrong brand is worse than failing boot.
- **Identity ≠ capability.** `config/products.ts` owns name/copy/legal;
  `config/features.ts` owns feature flags. Staging can run ScrapperNinja
  identity with enrichment off.
- **Two long-lived release branches** (`apply-next`/`master` and
  `scrapper-next`/`scrapper-master`) share `staging` for boilerplate. Product
  identity is env-driven so branches don't diverge on config. Detail:
  `docs/guides/two-product-production-plan.md`.

## 2026-07-28 — v1.1: tiers, extension redesign, branding, hosting

- **Numeric limits must not go through `hasAccess()`.** Its `toBoolean`
  returns true for any positive number, so a `profileLimit` of 1 and of 3 both
  read as "allowed". Booleans use `requireFeature()`; numerics use the typed
  readers in `lib/usage/enforce.ts`. `-1` = unlimited.
- **`EntitlementError` mimics `UsageLimitError` on purpose** (402 + `.payload`
  - `.status`), so the `catch → authErrorResponse(error)` tail every route
    already ends in serves it with no route changes, and the extension's
    existing `code`/`upgradeUrl` handling works unmodified.
- **Limits gate creation only; downgrades never delete.** A user dropping from
  Pro to Starter keeps every profile readable and editable.
- **CSV export can only be gated in the UI.** It's built client-side from data
  the user already holds — there is no server call to refuse. Stated as an
  accepted limit rather than pretended otherwise.
- **`npm run seed` now backfills missing limit keys** onto existing plan rows
  and never overwrites a value a super admin tuned, so an already-live
  database adopts new entitlements by re-running it.
- **Trial grants Starter, not Pro** — a week of the top tier costs more in AI
  calls and makes Starter look pointless afterwards. Trial-tier copy is now
  tier-neutral so it can't go stale again.
- **Popup open must cost zero AI calls.** It used to auto-run `analyze-job`,
  so every glance billed. `GET /api/usage` exists because usage was previously
  only obtainable from an AI response — you had to spend a call to learn you
  had none left. The `<40 chars` gate moved to Check Fit Score alone; an
  application FORM has almost no page text, and that's exactly where Quick
  Fill and Track matter.
- **Quick Fill runs in the popup, not the page.** Injected functions must be
  closure-free (dom-actions.ts), so matching happens in the popup and only the
  computed `{id,value}[]` crosses into the page via the existing `fillFields`.
- **`fill-data` ships decrypted EEO** — deliberate owner decision, the one
  place the "EEO stays server-side" rule is relaxed, and a reversal of
  7b3b0a2 for this endpoint only. `listProfileSummaries` still withholds it.
  The payload is a whitelist, never a spread, so new profile fields can't leak
  by default.
- **Absence of information is Neutral, never No.** The old prompt left this to
  inference, so a posting silent on sponsorship could come back "No". Silence
  is not refusal.
- **oklch can express out-of-gamut colours and browsers clip them silently.**
  Two obvious-looking values (`0.70 0.19 300`, `0.95 0.03 300`) are outside
  sRGB; max chroma at L=0.70 hue 300 is 0.186. Verify numerically before
  shipping a token.
- **No CD workflow, by design.** Railway's GitHub integration plus its "Wait
  for CI" setting is the deploy path; a workflow needing a `RAILWAY_TOKEN`
  that doesn't exist would fail on every push. `hard-delete` stays a plain npm
  script so any host can schedule it — that's what keeps hosting reversible.
- **`format:check` is not a CI gate.** The repo has never been Prettier-clean
  (44 files); adding it would make CI red on arrival.

## 2026-07-28 — v1.1: first-live-run bug fixes

- **Never import a runtime value from a `"use client"` module into a Server
  Component.** React hands back a client-reference _proxy_ whose only own props
  (`$$typeof`, `$$id`, `$$async`) are non-enumerable, so `{ ...value }` yields
  `{}` — silently, at SSR time. This crashed `/profiles/new`, which spread
  `emptyProfileValues` out of `ProfileForm.tsx`. Fix: shared form values/types
  live in **`lib/profiles/form-values.ts`** (a plain module both sides import).
  `import type` from a client module stays safe — types are erased. Don't
  "fix" a recurrence with optional chaining; that only moves the crash.
- **`pdfjs-dist` must never be webpack-bundled.** Its `legacy/build/pdf.mjs` is
  itself a pre-built webpack bundle declaring a top-level
  `var __webpack_exports__`, which shadows the binding Next injects — so the
  injected prologue runs `Object.defineProperty(undefined, …)` on import.
  `next.config.ts` lists `pdf-parse`/`pdfjs-dist`/`mammoth` in
  **`serverExternalPackages`** (the Next 15 top-level key; the `experimental.`
  form is deprecated). Verify by grepping the compiled route for a bare
  `import("pdf-parse")` and zero `__webpack_exports__`. Wipe `.next/` after
  changing this or the stale bundle is reused.
- **Form value types are the schema's mirror — extend both together.**
  `projects` existed end-to-end (Zod, adapter, service create _and_ update) but
  was missing from `ProfileFormValues`/`toFormValues`, so a resume-parsed
  projects list was persisted at create and erased on the first edit-and-save.
  Any field added to `profileSchema` needs a matching form value + editor
  section, or edits become silent data loss.

## 2026-07-28 — ApplyNinjaa v1 build (fork of template v1.0.0)

- **User-level billing rides the org schema.** `multiTenant` stays off; the
  silent default org (org ≡ user) is the billing entity, so checkout/webhook/
  subscriptions are reused unchanged. Never refactor subscriptions to userId —
  resolve "the user's plan" via `getEffectivePlan(session)`
  (lib/payments/access.ts: live sub → lazy trial expiry → Free-slug fallback).
- **No-card trial ≠ Stripe trial.** The 7-day Pro trial is a local `trialing`
  subscription row (no Stripe ids, end in `currentPeriodEnd`), started at
  email verification, once per verified email (`users.trial_used_at`), lazily
  expired on read — no cron. `checkout.ts` hard-sends `trialEnd: null`;
  re-enabling Stripe trials via `app_settings.trialDays` is intentionally
  impossible (that knob now sets the LOCAL trial length instead).
- **Usage/rate-limit data bypasses the DB adapter** (`lib/usage/`,
  `lib/gmail/store.ts`): atomic `$inc` + TTL indexes are Mongo primitives and
  operational, not tenant-domain, data — same precedent as
  `auth_credentials`. The fork is Mongo-only (Supabase adapters deleted §1.5),
  so no portability is lost. Cap enforcement is increment-first with
  refund-on-overshoot so the hard cap holds under concurrency.
- **One AI call per user action.** Popup analysis (all filter verdicts + fit
  score + company/role extraction) is a single `analyzeJob` generation; a
  whole Gmail scan (≤50 msgs, batched classification) bills as one action.
  Don't split these back into per-filter/per-email calls.
- **Extension has NO content script.** All page-DOM work is closure-free
  functions passed to `chrome.scripting.executeScript` (constraint documented
  in `extension/src/lib/dom-actions.ts`); activeTab+scripting on user gesture,
  host permission = backend origin only. Auth = one-time cookie→Bearer
  exchange (`purpose:"extension"`, 30d, chrome.storage.local); server side is
  `authorizeApi()` + middleware Bearer passthrough. Stateless tokens are
  unrevocable until expiry — accepted; add `users.tokenVersion` if that
  changes.
- **/admin is platform-staff only.** Every user is org-admin of their silent
  default org, so the template's org-admin gate would admit everyone. Support
  tier = `users.is_support_admin` (view users + refunds ONLY); destructive/
  pricing/filter/audit paths stay `superAdmin`. Two booleans, not a role
  enum, so existing `isSuperAdmin` checks stayed untouched.
- **EEO encryption boundary is the profile service.** `lib/profiles/service.ts`
  is the only importer of `lib/crypto/field-encryption.ts` for profile data
  (AES-256-GCM, per-user AAD, `v1.` version prefix); schema/adapter/routes
  only ever see packed ciphertext. Gmail refresh tokens reuse the same key.
- **Plan slugs are create-only.** Code finds plans by slug (`free`, `pro`) —
  names/prices are admin-editable, slugs never change after creation (admin
  PATCH omits slug by schema).
- **pdf-parse is v2, not v1.** Use the `PDFParse` class from the package root
  (`new PDFParse({ data })` → `getText()` → **`destroy()`**, or every upload
  leaks a pdf.js worker). Do NOT reach for the widely-copied v1 workaround
  `import pdf from "pdf-parse/lib/pdf-parse.js"` — v2's exports map rejects
  it and the failure surfaces only at `next build`, not at typecheck. Join
  `result.pages[].text` yourself; the concatenated `result.text` interleaves
  `-- 1 of N --` page markers that would read as resume content to the model.

## 2026-07-19 — Phase 10: docs finalization (template v1.0.0)

Closes the template. **CLAUDE.md and `.cursorrules` were already complete**, so
per the user's call we **reconciled rather than rewrote**: fixed CLAUDE.md §10
(it still described the Tailwind **v3** `tailwind.config.ts` + `hsl(var(--x))`
model; the fork is v4 CSS-first with `@theme inline` + `oklch` — now matches
`theming.md`) and lightly expanded `.cursorrules` (theming/v4, super-admin
separation, Zod-at-boundary, "read current-state first"). Established the
**prompt-file format** (framing → fenced copy-paste block with `[INPUTS]` →
related-links footer) across all six `docs/prompts/*`. Wrote a full
`getting-started.md` (standardized on **pnpm**, dropped the stub's `npm` +
`seed:test` claims since `seed:test` is still a stub) and a new `deployment.md`
(stresses `NEXT_PUBLIC_*` are build-time and `SKIP_ENV_VALIDATION` is build/CI
only). Refreshed `docs/README.md` (removed the stale "populated later" notes) and
seeded `docs/llm-context/` as a pointer to the distilled rulebook rather than
duplicating content. Marked the template **v1.0.0**.

## 2026-07-19 — Phase 9: SEO metadata, sitemap/robots, cookie banner, legal templates

SEO plumbing is **not flag-gated** (every fork wants it): the root `metadata`
export gained `metadataBase`/title-template/OpenGraph/Twitter/robots, and
`app/sitemap.ts` + `app/robots.ts` build absolute URLs from
`NEXT_PUBLIC_APP_URL`. **Runtime check caught a real bug** — `middleware.ts`
redirected `/robots.txt` and `/sitemap.xml` to `/login` (its matcher catches
them and they weren't public), so both were added to `isPublicPath`. The cookie
banner **is** flag-gated (`cookieBanner`, a flat boolean). Its consent cookie
(`ninjakit_cookie_consent`) is deliberately **client-managed and non-httpOnly**
(unlike the server-set auth/active-org cookies) because the banner must read it in
the browser to decide whether to render — its constant lives in the component,
not `lib/auth/constants.ts`, since it isn't an auth concern. The banner **starts
hidden and reveals after mount** (via `useEffect`) to avoid an SSR hydration
mismatch, and exposes `getCookieConsent()` so a fork can gate analytics on the
choice. It takes an optional `policyHref` rather than hardcoding a `/cookie-policy`
route that doesn't exist yet (no broken link). Legal docs ship as `[PLACEHOLDER]`
**templates** (not routed pages) plus a `generate-legal-docs.md` prompt — the fork
decides whether/how to route them. Verified end-to-end with a headless browser:
banner shows → Accept sets cookie → stays hidden on reload; `/robots.txt` +
`/sitemap.xml` render; metadata present in `<head>`.

## 2026-07-19 — Phase 8: AI integration (Anthropic + OpenAI behind one interface)

Two providers landed behind the standard `@/lib/ai` seam — `AiAdapter` interface
(`generate()` / `stream()`) with `anthropic/` and `openai/` implementations. Two
choices differ from the other adapters. **(1) Official SDKs over raw `fetch`** —
unlike the Twilio/Resend adapters, we added `@anthropic-ai/sdk` and `openai`
(user-confirmed) because they handle streaming and typing cleanly and follow the
Stripe/AWS-SDK precedent; hand-rolling SSE parsing for two providers wasn't worth
it. **(2) Provider-keyed accessor, not a single singleton** — `aiProviders` is an
**array** (several providers enable-able at once), so `lib/ai/index.ts` exposes
`ai(provider?)` with lazy per-provider caching rather than one global instance
like storage/phone/payments. Default provider = optional `AI_DEFAULT_PROVIDER`
env (no secret, no required-when rule) else the first enabled entry. DTOs are
provider-neutral (no SDK type past the seam); default model ids live in
`lib/ai/models.ts` so none are hardcoded in app code (§8). The example route
`app/api/ai/generate` is a non-streaming smoke test following the flag-404 →
`authorize()` → Zod contract; `stream()` exists on the adapter but the repo has
**no shared SSE helper yet** (noted for a future phase). Not runtime-verified
against live provider APIs (no keys here): typecheck + prod build pass, and the
selector/route 404 correctly when AI is off.

---

Earlier entries (Phase 7 and before) are in
[`decisions-archive.md`](./decisions-archive.md).
