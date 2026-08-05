# Data Layer

Living reference for the database adapter pattern. See CLAUDE.md §1.2, §2, §3.

## The pattern

The database is swappable, so it follows the interface+adapter rule: **one
interface**, one-or-more concrete implementations, and a single selector.
Application code imports only `db` from `@/lib/db` — never a concrete adapter,
never `DB_PROVIDER`, never a `if (provider === …)` branch.

```
lib/db/
  schema.ts         → canonical Zod domain models (User, Organization, OrganizationMember)
  adapter.ts        → the DatabaseAdapter interface (CORE — imported everywhere)
  index.ts          → selects the implementation from env.DB_PROVIDER (the ONLY branch point)
  supabase/
    adapter.ts      → Supabase implementation (RLS-aware, scoped by organization_id)
  mongodb/
    adapter.ts      → MongoDB/Mongoose implementation (organization_id indexed)
```

`schema.ts` is the single source of truth for entity shapes; both adapters map
their storage rows/documents to and from these types, so app code sees one shape
regardless of provider. IDs are strings; timestamps are `Date`.

## The interface (Phase 2)

`DatabaseAdapter` is intentionally minimal — user CRUD, organization CRUD, and
org-membership CRUD. Membership methods take `organizationId` first, so every
tenant-scoped operation is explicitly org-bound (§1.3). Later phases extend the
interface per-feature; each new table adds its methods here alongside a Zod
schema and a seed entry, in the same commit (§1.4).

## Multi-tenant schema

| Entity             | Table / collection         | Tenant-scoped?                  | Notes                                                                                                                                                                           |
| ------------------ | -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User               | `users`                    | No (global identity)            | `id`, `email` (unique), `name?`, **`is_super_admin`** (platform-level, §14), timestamps                                                                                         |
| Organization       | `organizations`            | Is the tenant boundary          | `id`, `name`, `slug` (unique), timestamps                                                                                                                                       |
| OrganizationMember | `organization_members`     | Yes — carries `organization_id` | `organization_id` + `user_id` (unique together, both indexed), `role`                                                                                                           |
| Invitation         | `organization_invitations` | Yes — carries `organization_id` | `email`, `role`, `token` (unique), `status` (pending/accepted/revoked), `invited_by_user_id`, `expires_at`                                                                      |
| Plan               | `plans`                    | **No — PLATFORM-level (§15)**   | `name`, `description?`, `price_monthly`, `price_annual?`, `annual_discount_percent?`, `limits` (JSON), `is_active`, `sort_order`, `stripe_*` ids. Prices are integer **cents**. |
| AppSettings        | `app_settings`             | No — PLATFORM-level singleton   | One row. `trial_days` (used to compute an org's `trial_ends_at` at creation)                                                                                                    |
| Subscription       | `subscriptions`            | Yes — carries `organization_id` | `plan_id`, `status`, `stripe_customer_id?`, `stripe_subscription_id?`, `current_period_end?`, `cancel_at_period_end`                                                            |

`organizations` also gained `stripe_customer_id?` + `trial_ends_at?` in Phase 5
(the org is the billing entity; subscriptions are org-scoped).

`role` is an extensible free string; `admin` and `user` are the built-ins
(`ORG_ROLES` in `lib/db/schema.ts`). What each role may do is defined in
`config/permissions.ts` (Phase 4) — add a role there, no schema change.

**`users.is_super_admin`** (Phase 4, §14) is a **platform-level** flag on the
user record itself — deliberately NOT in `organization_members`, because
pricing/billing are platform concerns independent of any org membership. It's
independent of the `multiTenant` flag and exists identically in single- and
multi-tenant deployments. Guarded by `requireSuperAdmin()`, which is kept
separate from `requireRole("admin")` (an org admin is never a super-admin). For
Supabase, add the column: `alter table users add column is_super_admin boolean
not null default false;`. Seed promotes `SUPER_ADMIN_EMAIL` (never hardcoded).

## Provider selection

`lib/db/index.ts` reads `env.DB_PROVIDER` (`supabase` | `mongodb`) and
instantiates the matching adapter once. Only the selected provider's connection
vars must be present — `config/env.schema.ts` validates them conditionally and
throws at boot naming any that are missing.

## Rules (CLAUDE.md)

- **No barrel files** inside the adapter subfolders (`supabase/`, `mongodb/`) —
  import directly from the specific module (§4).
- **Delete-what-you-don't-use** — when a fork picks a provider at init, remove
  the unused adapter folder and its `case` in `index.ts` (§1.5).
- **New table = three things, same commit** — Zod schema, `scripts/seed.ts`
  entry, adapter method(s) on both providers for tenant data (§1.4).
- **Native idioms** — each adapter feels native to its backend; don't bend one
  provider's conventions to imitate the other (§8).

## How to add a new database adapter (e.g. Prisma, DynamoDB)

1. Add the provider name to the `DB_PROVIDER` enum in `config/env.schema.ts` and
   add its connection vars (optional in the object; required via a rule in
   `requirementRules` when that provider is chosen).
2. Create `lib/db/<provider>/adapter.ts` exporting a class that
   `implements DatabaseAdapter`. Map the provider's rows/documents to and from
   the canonical types in `lib/db/schema.ts`. Keep every tenant-scoped query
   filtered by `organization_id`.
3. Add a `case` to the `switch` in `lib/db/index.ts`.
4. Document setup (env vars, local dev) in `docs/guides/choosing-database.md`.
5. No app code changes — that's the point.

## Status

Implemented in Phase 2: interface, Supabase + MongoDB adapters, selector, the
three-entity multi-tenant schema, and `scripts/seed.ts`. The Supabase adapter
uses the service-role key server-side; per-request user-scoped (RLS-enforcing)
clients arrive with auth in a later phase. SQL migrations / RLS policy files for
Supabase are **deferred** — see `docs/guides/choosing-database.md`.

Extended in Phase 3 (auth): `NewUser` gained an optional `id` (so the Supabase
auth uid can be the profile row id), and `listMembershipsForUser(userId)` was
added to resolve a user's org context. `db` is now created lazily on first use
(importing `@/lib/db` no longer requires a configured connection — useful for
builds). Auth credentials live in the auth layer, not the db layer: the MongoDB
flow stores bcrypt hashes in an `auth_credentials` collection; Supabase uses its
own `auth.users`.

## Phase 5 — payments & pricing tables

The interface gained `plans` CRUD, `app_settings` (`getAppSettings` /
`updateAppSettings`), `subscriptions` CRUD, and
`getOrganizationByStripeCustomerId` (for the webhook). Notes specific to this
phase:

- **`plans` is the one platform-level (non-tenant) table** — the sole, deliberate
  exception to "every table is tenant-scoped" (§1.3 / §15). It has **no**
  `organization_id`. `app_settings` is likewise platform-level (a singleton row).
  `subscriptions` **are** tenant-scoped (`organization_id`) — the org is the
  billing entity.
- **Stripe Price immutability (§15).** A Stripe Price cannot be edited in place.
  When a super admin changes a plan's price, the payments adapter
  (`lib/payments/`) creates a **new** Stripe Price, archives the old one
  (`deactivatePrice`), and relinks the plan's `stripe_price_id_*`. Existing
  subscribers keep their original price unless explicitly migrated — **never** try
  to mutate a Price. See `docs/guides/payments-setup.md`.
- **Trials.** `resolveTrialEndsAt()` (`lib/payments/trials.ts`) reads
  `app_settings.trial_days` and is called at org creation
  (`ensureDefaultOrganization`, `createOrganizationForUser`) to stamp
  `organizations.trial_ends_at`. Returns null when payments is off.
- **Supabase columns to add** (no migration files are generated in this fork):
  `organizations.stripe_customer_id text`, `organizations.trial_ends_at
timestamptz`; the `plans`, `app_settings`, and `subscriptions` tables (snake_case
  columns matching the Row shapes in `lib/db/supabase/adapter.ts`).
- **Feature-gating.** `hasAccess(session, feature)` (`lib/payments/access.ts`) is
  the single entry point — it reads the active plan's `limits` JSON and returns
  `true` whenever payments is off, so no other code branches on the payments flag.

### Entitlements stored in `plans.limits`

`limits` is an open JSON blob, so a new entitlement is a **seed/admin edit, not
a migration**. Two kinds, read two different ways:

| key               | kind    | free | starter | pro | premium |
| ----------------- | ------- | ---- | ------- | --- | ------- |
| `aiCallsPerMonth` | numeric | 5    | 50      | 150 | 300     |
| `profileLimit`    | numeric | 1    | 1       | 3   | `-1`    |
| `customFilters`   | boolean | ✗    | ✓       | ✓   | ✓       |
| `gmailScan`       | boolean | ✗    | ✗       | ✗   | ✓       |
| `dataExport`      | boolean | ✗    | ✗       | ✓   | ✓       |

- **Boolean** keys → `hasAccess()` / `requireFeature()` (throws
  `EntitlementError`: 402 + `{code:"FEATURE_LOCKED", feature, requiredPlan,
upgradeUrl}`, served by the `authErrorResponse` tail every route already has).
- **Numeric** keys → the typed readers in `lib/usage/enforce.ts`
  (`getAiCallCap`, `getProfileLimit`). **Never** `hasAccess()` for these — its
  `toBoolean` reports any positive number as `true`, so a limit of `3` and a
  limit of `1` would both read as "allowed". `-1` means unlimited.
- Upsell copy names the required plan via `lowestPlanWith()` /
  `lowestPlanWithLimitAbove()`, which read the plans table — never a hardcoded
  plan name (§15).
- Limits gate **creation only**. Downgrading never deletes data: a user who
  drops from Pro to Starter keeps every existing profile readable and editable
  and simply cannot create another.
- CSV export is built client-side from data the user already holds, so hiding
  the button is the only enforcement possible — an accepted limit, unlike the
  other three which are all enforced server-side.
- `npm run seed` backfills newly-added limit keys onto existing plan rows and
  leaves any value a super admin has already tuned untouched, so it stays safe
  to re-run against a live database.

## ApplyNinjaa domain tables

This fork resolved `DB_PROVIDER` to **MongoDB** and removed the Supabase
adapters (§1.5). The product tables below follow the standard rules: every
tenant-scoped collection carries an indexed `organization_id` (org ≡ user in
this fork — `multiTenant` is off, so each user has one silent default org),
and each table shipped with its Zod schema (`lib/db/schema.ts`), adapter
methods, and seed entry in the same commit (§1.4).

| Entity            | Collection             | Tenant-scoped? | Notes                                                                                                                                                     |
| ----------------- | ---------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile           | `profiles`             | Yes            | Multiple per user, unique `(user_id, name)`. Parsed resume data; `eeo` holds **field-level-encrypted ciphertext** only (lib/crypto).                      |
| ProfileDomainPref | `profile_domain_prefs` | Yes            | Last-used profile per job-site domain, unique `(user_id, domain)`.                                                                                        |
| Application       | `applications`         | Yes            | Tracked jobs; status enum (10 values), user-editable `fit_score`, denormalized `filter_results`. Indexed `(user_id, applied_at)` and `(user_id, status)`. |
| JobFilter         | `job_filters`          | No (mixed)     | `type: admin` = platform master list (no owner); `type: user` = one user's custom filter (`owner_id`).                                                    |
| UserFilterSetting | `user_filter_settings` | Yes            | Per-user enable/disable of filters, unique `(user_id, filter_id)`.                                                                                        |
| AdminAction       | `admin_actions`        | No             | Append-only audit log (who/what/when/why); reads newest-first.                                                                                            |
| GmailScan         | `gmail_scans`          | Yes            | Manual scan runs + per-email proposals; nothing writes to applications until a proposal is user-approved.                                                 |

User extensions: `is_support_admin` (second platform admin tier — never merged
with `is_super_admin` checks), `status` (active/suspended/banned/
pending_deletion), `email_verified_at`, `trial_used_at` (one free trial per
verified email), `deleted_at` (30-day soft delete), `marketing_emails_enabled`

- `unsubscribe_token` (CAN-SPAM).

Plan extensions: unique `slug` (stable lookup — `free`/`starter`/`pro`/
`premium`; names and prices are admin-editable, slugs are create-only) and the
`limits.aiCallsPerMonth` cap read by the AI quota enforcement.

Operational data (AI usage counters, short-window rate limits) deliberately
does NOT go through this adapter — it lives in the Mongo-only `lib/usage/`
module because atomic `$inc` upserts and TTL indexes are Mongo primitives, the
same precedent as `auth_credentials` in the auth adapter.

## ScrapperNinja domain tables (Phase 1)

Five collections back the Lead Directory (`/leads`), gated by the `scraper`
flag. Each shipped with its Zod schema (`lib/db/schema.ts`), adapter methods,
and seed entry in the same commit (§1.4); all are tenant-scoped with an indexed
`organization_id`. Definitions live in `lib/db/mongodb/adapter.ts`.

| Entity          | Collection            | Tenant-scoped? | Key fields                                                                                                                                               | Notable indexes                                                                                                                                                                          |
| --------------- | --------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead            | `leads`               | Yes            | `business_name`, `category`, `description` (the source's own blurb — `notes` is the user's), `phone`/`phone_e164`, `website`/`website_domain`, `address`, `owner_name`, `emails`, `socials`, `tech_stack`, `score`, `offer_line`, `status` (`new`/`needs_review`/`ready`/`exported`/`junk`), `source_type`, `client_capture_id`, `parse_issues`, `custom_fields`, `dedupe_keys`, `deleted_at` (soft delete). | `(org, createdAt)`, `(org, status)`, `(org, phone_e164)`, `(org, website_domain)`, `(org, campaign_ids)`, `(org, score desc)`, `business_name` text; **unique sparse `(org, client_capture_id)`** for idempotent capture. |
| Campaign        | `campaigns`           | Yes            | `name`, `description`, `query`, `location`, `source_type`, `status` (`active`/`archived`), denormalized `lead_count`, `created_by_user_id`.               | `(org, createdAt)`.                                                                                                                                                                     |
| LeadSource      | `lead_sources`        | Yes            | Per-capture provenance: `lead_id`, `source_type`, `source_url`, `campaign_id`, `captured_at`, `raw_payload` (original scrape). One lead can have many.    | `(org, lead_id)`.                                                                                                                                                                       |
| SavedView       | `saved_views`         | Yes            | Per-user Lead Directory presets: `name`, `columns`, `filters`, `sort`, `page_size`, `is_default`.                                                         | unique `(user_id, name)`.                                                                                                                                                               |
| LeadCustomField | `lead_custom_fields`  | Yes            | Org-defined extra columns: `key`, `label`, `type` (`text`/`number`/`select`/`date`/`boolean`), `options`, `sort_order`. Values live in `leads.custom_fields`. | unique `(org, key)`.                                                                                                                                                                    |

Capture is **idempotent** on `(organization_id, client_capture_id)`: a
re-submitted capture (extension retry, CSV re-import) upserts the same row
instead of duplicating. `leads` is soft-deleted via `deleted_at`; the query
layer (`lib/leads/query.ts`) excludes `junk` and deleted rows by default.

## ScrapperNinja capture tables (Phase 2)

Two more collections back the capture pipeline (extension ingest + rescue),
gated by the `scraper` flag. `source_packs` is **platform-level** — like `plans`
it has **no `organization_id`** (§15, the deliberate §1.3 exception), because the
same selectors serve every tenant's extension. `capture_sessions` is
tenant-scoped like the rest.

| Entity         | Collection         | Tenant-scoped?     | Key fields                                                                                                                                                    | Notable indexes                                    |
| -------------- | ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| SourcePack     | `source_packs`     | No (platform, §15) | Server-pushed selectors: `source_id`, `version`, `automation_tier`, `selectors` (field→CSS map), `notes`, `is_active`. Extension fetches active packs, caches by `version`. | unique `source_id`; `is_active`.                   |
| CaptureSession | `capture_sessions` | Yes                | One extension run: `campaign_id`, `source_type`, `source_url`, `mode` (`fast`/`deep`), `started_at`/`ended_at`, `captured_count`, `needs_review_count`, `status` (`running`/`completed`/`failed`/`canceled`), `extension_version`, `created_by_user_id`. | `(org, started_at desc)`.                          |

Ingest (`POST /api/leads/ingest`, Bearer) upserts each record on
`(org, client_capture_id)`, writes one `lead_sources` provenance row per record,
bumps `campaign.lead_count` for **newly-created** leads only, and marks records
that arrived with `parse_issues[]` as `needs_review` (keeping `raw_snippet`). Up
to 25 flagged records are repaired **inline** via DeepSeek (`lib/scrape/rescue.ts`);
the rest are drained by `POST /api/leads/rescue`. Every AI call goes through
`enforceAiQuota` + `recordAiCall`; task→provider routing lives in
`lib/ai/routing.ts` (all tasks → DeepSeek today). Selector-pack CRUD is
super-admin-only at `/api/admin/source-packs` (`authorizeApi({ superAdmin: true })`,
§14); the extension reads active packs at `GET /api/scrape/selectors`.

## ScrapperNinja processing tables (Phase 3)

Three more collections back the batch processing pipeline (normalize, dedupe,
enrich, label, score, offer — see `scraping.md`), gated by the `scraper` flag and
all tenant-scoped. Each shipped with its Zod schema, adapter methods, and (for
`offer_prompts`) a seed entry in the same commit (§1.4). `app_settings` also
gained a `lead_scoring_rubric` string (platform-level singleton; seeded from
`DEFAULT_SCORING_RUBRIC`, super-admin editable).

| Entity             | Collection             | Tenant-scoped? | Key fields                                                                                                                                                                              | Notable indexes                              |
| ------------------ | ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| BatchJob           | `batch_jobs`           | Yes            | An async pass over a lead selection: `type` (`rescue`/`normalize`/`dedupe`/`label`/`enrich`/`score`/`offer`), `status` (`queued`/`running`/`done`/`failed`/`canceled`), `target_filter` (serialized lead query) **or** `lead_ids[]`, counters `total`/`processed`/`succeeded`/`failed`, `error`, `params`, `created_by_user_id`, `started_at`/`finished_at`. | `(org, createdAt desc)`, `(org, status)`.    |
| OfferPrompt        | `offer_prompts`        | Yes            | A reusable cold-email opener template: `name`, `prompt_text` (with `{{placeholders}}`), `is_default` (≤1 per org, enforced in the service), `provider`/`model`, `created_by_user_id`.    | `(org, createdAt)`.                          |
| DuplicateCandidate | `duplicate_candidates` | Yes            | A pair the dedupe pass flagged for human review: `lead_a_id`, `lead_b_id`, `matched_on[]` (`phone`/`domain`/`name`), `confidence` (0–1), `status` (`pending`/`merged`/`dismissed`).      | `(org, status)`, `(org, lead_a_id)`.         |

Jobs run **in-process** via `after()` (no Redis/worker) — see `lib/jobs/runner.ts`
and the pipeline section in `scraping.md` for chunking, cancel/resume, stale
detection, and per-lead AI-quota enforcement. Dedupe **only ever writes
candidates** (`duplicate_candidates`); a merge is applied exclusively by the human
review endpoints (`/api/duplicates/[id]/merge|dismiss`), which repoint
`lead_sources` from the loser to the primary and soft-delete the loser with
`merged_into_id` set.
