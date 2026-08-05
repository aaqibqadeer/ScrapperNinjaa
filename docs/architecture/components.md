<!--
  ============================================================================
  COMPONENT CATALOG — living document (CLAUDE.md §9).

  Every new shared component MUST be added here in the SAME COMMIT it's
  introduced. Check this file BEFORE building a new component — reuse or extend
  an existing one before duplicating.

  Scope: everything in /components/ui (shadcn primitives) and /components/shared
  (our own reusable components). Feature-scoped components (/components/<feature>)
  are listed only once they're promoted to /shared per §9.4.
  ============================================================================
-->

# Component Catalog

Living catalog of every reusable component in the template.

## `/components/ui` — shadcn primitives

Unmodified shadcn/ui primitives (style: new-york). Tracked from day one so the
catalog reflects _all_ reusable UI, not just custom components.

| Component                                                                                                                         | Location                          | Purpose                                                                                        | Key Props                                                                                                                    | Used In                              |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `Button`                                                                                                                          | `components/ui/button.tsx`        | Clickable action / link-styled action.                                                         | `variant` (default \| destructive \| outline \| secondary \| ghost \| link), `size` (default \| sm \| lg \| icon), `asChild` | `SiteHeader`, `Hero`, marketing/auth |
| `Card` (+ `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`)                                | `components/ui/card.tsx`          | Surface container for grouped content.                                                         | standard `div` props via `className` composition                                                                             | `app/dashboard`, auth/admin cards    |
| `Input`                                                                                                                           | `components/ui/input.tsx`         | Single-line text/email/etc. form field.                                                        | native `input` props (`type`, `placeholder`, `disabled`, …)                                                                  | auth forms                           |
| `Label`                                                                                                                           | `components/ui/label.tsx`         | Accessible label for a form control.                                                           | native `label` props, `htmlFor`                                                                                              | auth forms                           |
| `DropdownMenu` (+ `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`) | `components/ui/dropdown-menu.tsx` | Radix dropdown menu (new-york).                                                                | Radix `DropdownMenu.*` props; `Item` `onSelect`, `inset`                                                                     | `WorkspaceSwitcher`                  |
| `Dialog` (+ `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`)  | `components/ui/dialog.tsx`        | Radix modal dialog (new-york). Built-in close button uses inline SVG (no icon-lib dependency). | `open`, `onOpenChange`; Radix `Dialog.*` props                                                                               | `WorkspaceSwitcher`                  |
| `Badge`                                                                                                                           | `components/ui/badge.tsx`         | Small status/label pill.                                                                       | `variant` (default \| secondary \| destructive \| outline)                                                                   | admin overview / tables (Phase 7)    |
| `Table` (+ `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`)                                                      | `components/ui/table.tsx`         | Plain semantic table wrappers (scrolls on overflow).                                           | native table-element props                                                                                                   | `DataTable`                          |
| `Switch`                                                                                                                          | `components/ui/switch.tsx`        | Dependency-free on/off toggle (`role="switch"`).                                               | `checked`, `onCheckedChange`, `disabled`                                                                                     | `PlanManager`                        |
| `Toaster` (sonner)                                                                                                                | `components/ui/sonner.tsx`        | App toast host; mounted once in the root layout. Fire toasts with `toast` from `sonner`.       | `sonner` `ToasterProps`                                                                                                      | `app/layout.tsx`                     |
| `Select`                                                                                                                          | `components/ui/select.tsx`        | Styled native `<select>` (dependency-free, like Switch).                                       | native select props                                                                                                          | ProfileForm, ApplicationsTable       |
| `Textarea`                                                                                                                        | `components/ui/textarea.tsx`      | Styled native textarea.                                                                        | native textarea props                                                                                                        | ProfileForm                          |
| `Checkbox`                                                                                                                        | `components/ui/checkbox.tsx`      | Styled native checkbox (dependency-free).                                                      | native input props                                                                                                           | ProfileForm, ApplicationsTable       |
| `Progress`                                                                                                                        | `components/ui/progress.tsx`      | Determinate progress bar.                                                                      | `value` (0-100)                                                                                                              | OnboardingWizard                     |

## `/components/shared` — custom reusable components

| Component           | Location                                  | Purpose                                                                                                                                                                                                                                          | Key Props                                                                    | Used In                                                          |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `WorkspaceSwitcher` | `components/shared/WorkspaceSwitcher.tsx` | Active-org dropdown + "Create organization" dialog. Render only when `features.multiTenant`.                                                                                                                                                     | `organizations: {id,name}[]`, `activeOrgId`                                  | `app/dashboard/page.tsx`                                         |
| `FileUpload`        | `components/shared/FileUpload.tsx`        | Presigned-URL file uploader (POST `/api/storage/upload-url` → PUT to storage). Renders null when `features.storage` is off.                                                                                                                      | `onUploaded?(: {key})`, `accept?`, `label?`, `maxSizeMb?`                    | _(Phase 6 — drop into any form)_                                 |
| `PhoneVerify`       | `components/shared/PhoneVerify.tsx`       | Two-step SMS verification (start → check). Placement-agnostic via `onVerified`. Renders null when `features.phoneVerification` is off.                                                                                                           | `defaultPhone?`, `onVerified?(phone)`                                        | _(Phase 6 — signup / settings / modal)_                          |
| `ConfirmDialog`     | `components/shared/ConfirmDialog.tsx`     | Confirm-before-action dialog for destructive/financial actions. Built on `Dialog`; runs `onConfirm`, shows errors inline, closes on success.                                                                                                     | `trigger`, `title`, `description?`, `onConfirm`, `destructive?`, `children?` | `PlanManager`, `SubscriptionsTable`                              |
| `DataTable`         | `components/shared/DataTable.tsx`         | Generic table over the `Table` primitive — declare `columns` (`header` + `cell`) and `rows`; falls back to `EmptyState`.                                                                                                                         | `columns`, `rows`, `getRowKey`, `empty?`                                     | `PlanManager`, `SubscriptionsTable`, admin org list              |
| `EmptyState`        | `components/shared/EmptyState.tsx`        | Consistent empty-list placeholder.                                                                                                                                                                                                               | `title`, `description?`, `action?`                                           | `DataTable`, admin tables                                        |
| `RowNumberCell`     | `components/shared/RowNumberCell.tsx`     | Global `#` column cell — offset-aware row number `(page-1)*pageSize + index + 1` (defaults collapse to `index+1` for unpaginated lists). Also exports the `rowNumber()` helper.                                                                    | `index`, `page?`, `pageSize?`, `className?`                                  | `LeadsTable`, `CaptureSessionsTable`, `AdminUsersTable`, `SubscriptionsTable`, `PlanManager`, `SourcePacksManager` |
| `CookieBanner`      | `components/shared/CookieBanner.tsx`      | Flag-gated cookie-consent banner (accept/reject → first-party cookie). Client component; renders null when `features.cookieBanner` off or a choice was already made. Exposes `getCookieConsent()`.                                               | `policyHref?`                                                                | `app/layout.tsx`                                                 |
| `BrandMark`         | `components/shared/BrandMark.tsx`         | Token-only logomark (shuriken glyph on a `primary` tile). Pair with the wordmark; recolors with the theme.                                                                                                                                       | `className?`                                                                 | `SiteHeader`, `SiteFooter`, `AppHeader`                          |
| `UpgradeNotice`     | `components/shared/UpgradeNotice.tsx`     | Dashed-border upsell card for a plan-locked feature — the graceful "not rendered" half of a tier gate (server guards in `lib/payments/access.ts` do the enforcing). Pass `requiredPlan` read from the plans table, never a hardcoded name (§15). | `title`, `description`, `requiredPlan?`, `action?`                           | `app/settings/gmail/page.tsx`, `app/profiles/page.tsx`           |
| `ThemeToggle`       | `components/shared/ThemeToggle.tsx`       | Light/dark toggle — swaps the `dark` class on `<html>` and persists to localStorage; initial theme applied pre-hydration by the inline script in `app/layout.tsx`. Icons swap via CSS `dark:` variant (hydration-safe).                          | _(none)_                                                                     | `SiteHeader`, `AppHeader`                                        |
| `SiteHeader`        | `components/shared/SiteHeader.tsx`        | Public marketing header (sticky, translucent). Shows Log in / Get started, or a Dashboard link when `signedIn`.                                                                                                                                  | `signedIn?`                                                                  | `app/page.tsx`                                                   |
| `SiteFooter`        | `components/shared/SiteFooter.tsx`        | Public footer with legal links (Privacy / Terms / Cookie Policy) + year.                                                                                                                                                                         | _(none)_                                                                     | `app/page.tsx`, legal pages                                      |
| `LegalPage`         | `components/shared/LegalPage.tsx`         | Shell for public legal documents — header/footer + styled article column.                                                                                                                                                                        | `title`, `updated`                                                           | `/privacy`, `/terms`, `/cookie-policy`                           |
| `AppHeader`         | `components/shared/AppHeader.tsx`         | Global signed-in nav bar. Server component: derives links from flags + role, mounts `WorkspaceSwitcher` (multi-tenant) + `LogoutButton`.                                                                                                         | `session`                                                                    | `app/dashboard`, `app/settings/organization`, `app/admin/layout` |
| `AppNav`            | `components/shared/AppNav.tsx`            | Client nav link row with active-route highlighting (`usePathname`). Links computed server-side and passed in.                                                                                                                                    | `links: {href,label}[]`, `className?`                                        | `AppHeader`                                                      |
| `Pagination`        | `components/shared/Pagination.tsx`        | Range summary ("1–25 of 412") + Prev/Next + page-size Select. Presentational; parent owns query state.                                                                                                                                          | `page`, `pageSize`, `total`, `pageSizeOptions?`, `onPageChange`, `onPageSizeChange`                    | _(ScrapperNinja Lead Directory)_ |
| `SortableHeader`    | `components/shared/SortableHeader.tsx`    | Clickable table header that toggles sort (asc→desc) with a chevron indicator; `aria-sort` for a11y.                                                                                                                                             | `label`, `columnKey`, `sortKey`, `sortDir` ('asc'\|'desc'\|null), `onSort(key)`                        | _(ScrapperNinja Lead Directory)_ |
| `ColumnFilter`      | `components/shared/ColumnFilter.tsx`      | Type-aware single-column filter control (text / number+date range / enum checkboxes / boolean Any-Yes-No). Compact for a filter row or popover.                                                                                                 | `column: {key,label,type,enumValues?}`, `value` (polymorphic), `onChange`                              | _(ScrapperNinja Lead Directory)_ |
| `ColumnPicker`      | `components/shared/ColumnPicker.tsx`      | Show/hide columns + reorder visible ones via native HTML5 drag-and-drop (no dnd lib); hidden columns listed separately.                                                                                                                          | `columns: {key,label}[]`, `visibleKeys`, `onChange(visibleKeysOrdered)`                                | _(ScrapperNinja Lead Directory)_ |
| `BulkActionBar`     | `components/shared/BulkActionBar.tsx`     | Selection toolbar shown when rows are selected: count, Clear, caller's action buttons, optional "select all N matching" link.                                                                                                                   | `selectedCount`, `totalMatching`, `onClear`, `onSelectAllMatching?`, `children`                        | _(ScrapperNinja Lead Directory)_ |
| `InlineEditCell`    | `components/shared/InlineEditCell.tsx`    | Click-to-edit table cell (text or select); Enter/blur saves optimistically, Escape cancels, muted placeholder when empty.                                                                                                                        | `value`, `onSave(next)`, `type?`, `options?`, `readOnly?`, `className?`                                | _(ScrapperNinja Lead Directory)_ |
| `DetailDrawer`      | `components/shared/DetailDrawer.tsx`      | Right-side panel adapted from the Radix `Dialog` (no Sheet primitive) — full-height, slides in from the right, with optional pinned footer.                                                                                                     | `open`, `onOpenChange`, `title`, `children`, `footer?`                                                 | _(ScrapperNinja Lead Directory)_ |
| `SavedViewsMenu`    | `components/shared/SavedViewsMenu.tsx`    | Saved-views dropdown: load, save-current-as (inline input), set default (star), delete (inline confirm).                                                                                                                                        | `views: {id,name,isDefault}[]`, `activeViewId`, `onLoad`, `onSave`, `onSetDefault`, `onDelete`         | _(ScrapperNinja Lead Directory)_ |
| `CsvImportDialog`   | `components/shared/CsvImportDialog.tsx`   | Guided CSV importer: pick file → parse client-side → map columns to lead fields → import → summary. Exposes `LEAD_IMPORT_FIELDS`.                                                                                                                | `open`, `onOpenChange`, `onImport(payload) => Promise<{imported,errors}>`                              | _(ScrapperNinja Lead Directory)_ |

Other candidates (per §9.2) — avatars, loading skeletons — are built
here the first time they're needed, with an entry added in the same commit.

## `/components/marketing` — landing-page components

Feature-scoped (§9.4): reusable within the public marketing surface. Presentational
server components; content lives in local data arrays a fork edits in place.

| Component        | Location                                  | Purpose                                                                                     | Key Props                | Used In        |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------ | -------------- |
| `Hero`           | `components/marketing/Hero.tsx`           | Landing hero — badge, headline, CTAs, product-screenshot placeholder, audience strip.       | _(none)_                 | `app/page.tsx` |
| `HowItWorks`     | `components/marketing/HowItWorks.tsx`     | 4-step "how it works" section (`#how-it-works` anchor).                                     | _(none)_                 | `app/page.tsx` |
| `PricingSection` | `components/marketing/PricingSection.tsx` | Public pricing cards from the plans table with a monthly/annual toggle (`#pricing` anchor). | `plans`, `annualBilling` | `app/page.tsx` |
| `Testimonials`   | `components/marketing/Testimonials.tsx`   | Testimonial grid — placeholder quotes, real structure.                                      | _(none)_                 | `app/page.tsx` |

(The template's `FeatureShowcase`/`CtaSection` were removed with the
ApplyNinjaa landing rework.)

## `/components/admin` — admin panel components (Phase 7)

Feature-scoped (§9.4): reusable within the admin panel, gated behind
`features.admin`. Super-admin surfaces additionally require `requireSuperAdmin()`.

| Component            | Location                                  | Purpose                                                              | Key Props                                                      | Used In                            |
| -------------------- | ----------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| `AdminNav`           | `components/admin/AdminNav.tsx`           | Admin tab nav; tabs show per the viewer's tier + flags.              | `isOrgAdmin`, `isSuperAdmin`, `multiTenant`, `paymentsEnabled` | `app/admin/layout.tsx`             |
| `TrialDaysForm`      | `components/admin/TrialDaysForm.tsx`      | Edit the platform-wide trial length (super-admin).                   | `initialTrialDays`                                             | `app/admin/settings/page.tsx`      |
| `PlanManager`        | `components/admin/PlanManager.tsx`        | Plan table with active toggle, edit, delete (super-admin).           | `plans`, `annualBilling`, `paymentsEnabled`                    | `app/admin/plans/page.tsx`         |
| `PlanFormDialog`     | `components/admin/PlanFormDialog.tsx`     | Create/edit-plan dialog form; price change mints a new Stripe Price. | `trigger`, `plan?`, `annualBilling`                            | `PlanManager`                      |
| `SubscriptionsTable` | `components/admin/SubscriptionsTable.tsx` | Cross-org subscriptions with cancel + refund (confirm dialogs).      | `rows`                                                         | `app/admin/subscriptions/page.tsx` |
| `SourcePacksManager` | `components/admin/SourcePacksManager.tsx` | Selector-pack CRUD (super-admin, scraper): list, edit selectors JSON, notes, version, `isActive` toggle, delete. Platform-level. | `packs`                                                       | `app/admin/source-packs/page.tsx` |

## `/components/auth` — auth feature components (Phase 3)

Feature-scoped (§9.4): reusable within auth. Each reads `config/features.ts` and
renders only enabled methods, so they degrade gracefully when a flag is off.

| Component           | Location                                | Purpose                                                              | Key Props | Used In                       |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------- | --------- | ----------------------------- |
| `LoginForm`         | `components/auth/LoginForm.tsx`         | Sign-in card: password + magic-link + OAuth, per enabled flags.      | `next?`   | `app/login/page.tsx`          |
| `SignupForm`        | `components/auth/SignupForm.tsx`        | Registration card: email/password + OAuth.                           | _(none)_  | `app/signup/page.tsx`         |
| `ResetPasswordForm` | `components/auth/ResetPasswordForm.tsx` | Dual-mode: request a reset link, or set a new password with a token. | `token?`  | `app/reset-password/page.tsx` |
| `MagicLinkForm`     | `components/auth/MagicLinkForm.tsx`     | Passwordless email link request.                                     | _(none)_  | `LoginForm`                   |
| `OAuthButtons`      | `components/auth/OAuthButtons.tsx`      | One button per enabled OAuth provider.                               | `next?`   | `LoginForm`, `SignupForm`     |
| `LogoutButton`      | `components/auth/LogoutButton.tsx`      | Clears the session and redirects to login.                           | _(none)_  | `app/dashboard/page.tsx`      |
| `AuthDivider`       | `components/auth/AuthDivider.tsx`       | Labelled "or" separator between method groups.                       | `label?`  | `LoginForm`, `SignupForm`     |

## `/components/org` — multi-tenant feature components (Phase 4)

Feature-scoped (§9.4): reusable within the org/multi-tenant surface, gated behind
`features.multiTenant`. Promote to `/components/shared` if a second, unrelated
feature needs the same pattern.

| Component            | Location                                | Purpose                                                    | Key Props                  | Used In                              |
| -------------------- | --------------------------------------- | ---------------------------------------------------------- | -------------------------- | ------------------------------------ |
| `CreateOrgForm`      | `components/org/CreateOrgForm.tsx`      | Create an org (POST `/api/org`) and switch to it.          | `onSuccess?`               | `WorkspaceSwitcher`                  |
| `InviteMemberForm`   | `components/org/InviteMemberForm.tsx`   | Invite a member by email + role to the active org (admin). | _(none)_                   | `app/settings/organization/page.tsx` |
| `MemberList`         | `components/org/MemberList.tsx`         | Roster with role change + remove (admin); self-row locked. | `members`, `currentUserId` | `app/settings/organization/page.tsx` |
| `PendingInvites`     | `components/org/PendingInvites.tsx`     | Pending invitations with a revoke action (admin).          | `invites`                  | `app/settings/organization/page.tsx` |
| `AcceptInviteButton` | `components/org/AcceptInviteButton.tsx` | Accept an invitation (POST `/api/org/invitations/accept`). | `token`                    | `app/invite/[token]/page.tsx`        |

## `/components/profiles`, `/components/filters`, `/components/dashboard`, `/components/onboarding` — ApplyNinjaa feature components

| Component           | Location                                     | Purpose                                                                                                                     |
| ------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ProfileForm`       | `components/profiles/ProfileForm.tsx`        | Full profile editor (contact/summary/skills/experience/education/links/preferences + EEO behind explicit consent checkbox). |
| `ProfileEditor`     | `components/profiles/ProfileEditor.tsx`      | Client wrapper persisting ProfileForm via POST/PATCH `/api/profiles`.                                                       |
| `ProfileList`       | `components/profiles/ProfileList.tsx`        | Profile rows with edit / make-default / delete.                                                                             |
| `FilterToggles`     | `components/filters/FilterToggles.tsx`       | Valid Job filter toggles (admin defaults + own custom, add/remove). Used by onboarding step 4 and `/settings/filters`.      |
| `ApplicationsTable` | `components/dashboard/ApplicationsTable.tsx` | Fully inline-editable tracker table: sort, search + status filter, bulk mark-rejected/delete, CSV export.                   |
| `OnboardingWizard`  | `components/onboarding/OnboardingWizard.tsx` | 5-step onboarding (welcome → resume parse → review → filters → done) with progress bar.                                     |
| `VerifyEmailBanner` | `components/auth/VerifyEmailBanner.tsx`      | Resend-verification nudge for unverified accounts (verification starts the free trial).                                     |

## `/components/leads` — ScrapperNinja feature components (Phase 1)

Feature-scoped to the Lead Directory (`scraper` flag). All are `'use client'`
(interactive tables/drawers/pickers). The shared table primitives they build on
(`DataTable`, column visibility, pagination) live in `/components/shared`.

| Component            | Location                                    | Purpose                                                                                                                                         |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `LeadsTable`         | `components/leads/LeadsTable.tsx`           | The Lead Directory: server-filtered/sorted/paginated table with column show/hide, saved-view load/save, inline status edits, CSV export, a live `needs_review` count chip, and a **"Rescue N records"** action (POST `/api/leads/rescue`). |
| `LeadDetailDrawer`   | `components/leads/LeadDetailDrawer.tsx`     | Side drawer for one lead: full field view, inline edits, parse-issue review, and a Provenance section listing every `lead_sources` row (GET `/api/leads/:id/sources`); persists via PATCH `/api/leads/:id`.                             |
| `CampaignPicker`     | `components/leads/CampaignPicker.tsx`       | Pick-or-quick-create campaign selector used when assigning leads.                                                                                |
| `CampaignsManager`   | `components/leads/CampaignsManager.tsx`     | Campaigns list with inline create, archive/reactivate, and delete (full lifecycle; the picker owns quick-create only).                          |
| `CaptureSessionsTable` | `components/leads/CaptureSessionsTable.tsx` | Read-only capture-session history (GET `/api/capture-sessions`): startedAt, source, mode, captured/needs-review counts, status, endedAt. Built on shared `DataTable`. Used in `app/leads/sessions/page.tsx`. |
| `CustomFieldManager` | `components/leads/CustomFieldManager.tsx`   | Org-level custom-column CRUD (key/label/type/options) backing `leads.custom_fields`.                                                             |
| `DuplicateReview`    | `components/leads/DuplicateReview.tsx`      | Phase 3 duplicate-candidate queue: side-by-side lead A/B compare with a per-field radio to pick the surviving value + a primary selector; Merge (POST `/api/duplicates/:id/merge`) or "Keep both" (POST `/api/duplicates/:id/dismiss`). Degrades gracefully on 404. Used in `app/leads/duplicates`. |
| `OfferPromptsManager`| `components/leads/OfferPromptsManager.tsx`  | Phase 3 offer-prompt CRUD (`/api/prompts*`) with a live preview against a real recent lead (POST `/api/prompts/preview`). Used in `app/leads/prompts`. |

## `/components/jobs` — AI-pass jobs (Phase 3)

Feature-scoped to the async AI-pass jobs (normalize/dedupe/label/enrich/score/
offer/rescue) that run over a lead selection. All `'use client'`. Backend
`/api/jobs*` routes are owned separately; the fetch wrappers in
`components/jobs/api.ts` + client types in `components/jobs/types.ts` degrade
gracefully (status-carrying results, toast on 404/402) until they land.

| Component        | Location                          | Purpose                                                                                                                                                                     |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JobProgress`    | `components/jobs/JobProgress.tsx`  | Compact progress card for one job: type, status badge, processed/total bar, succeeded/failed counts, Cancel while active, and Resume when a running job is stale (>10m old, no recent `updatedAt`). Self-polls `GET /api/jobs/:id` every 2s while queued/running (opt out via `selfPoll={false}` when a parent polls). |
| `JobsPanel`      | `components/jobs/JobsPanel.tsx`    | Recent jobs for the org (active first), each a `JobProgress`. Polls the list while any job is active. Meant to sit inside the shared `DetailDrawer` (the `/leads` "Jobs" button).                                                                                          |
| `RunAiPassDialog`| `components/jobs/RunAiPassDialog.tsx` | Launch dialog: pick a job type, see an estimated AI-call count (server `estimateOnly` when available, else a client-side guess), confirm. `offer` reveals prompt/variants(1\|3)/skip-edited; flag-gated types (`enrich`, `offer`) render disabled.                       |

## `extension/` — multi-product Chrome extensions (P1)

The extension folder builds **two** independent MV3 extensions from one shared
codebase (`docs/guides/two-product-production-plan.md` §P1). It is not React
UI in the web app, but it is a reuse surface worth cataloguing.

- `extension/shared/` — code both products import: `api.ts` (Bearer auth client),
  `types.ts` (backend response shapes), `popup.css` (token mirror of the web
  theme). Product code imports these via relative paths (`../../../shared/api`).
- `extension/products/<product>/` — each product owns its `manifest.template.json`,
  `popup.html`, `src/background.ts` (service worker), `src/popup/{App,main}.tsx`,
  and any product-only libs. ApplyNinjaa also has `src/lib/{dom-actions,quick-fill}.ts`;
  ScrapperNinja adds `src/content.ts`, `src/lib/{queue,sync}.ts` and `src/scrapers/`.
- Build: `vite.config.ts` reads `PRODUCT` (`applyninja` | `scrapperninja`) and
  emits `dist/<product>/`; ScrapperNinja gets a second IIFE pass
  (`vite.content.config.ts`) for its content script. See
  `docs/architecture/scraping.md` for the content-script constraint and
  `docs/guides/scraper-setup.md` for the build commands.
