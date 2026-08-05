/**
 * lib/db/schema.ts — canonical, provider-agnostic domain models (CLAUDE.md §1.4).
 *
 * These Zod schemas are the single source of truth for the shape of core
 * entities. Both adapters (Supabase, MongoDB) map their storage rows/documents
 * to and from these types, so app code sees one consistent shape regardless of
 * provider.
 *
 * Multi-tenant rule (§1.3): `organizations` is the tenant boundary and every
 * tenant-scoped table carries `organization_id`. Here, `organization_members`
 * is tenant-scoped. `users` are global identities that join orgs via membership.
 *
 * IDs are strings (Supabase uuid / Mongo ObjectId hex). Timestamps are `Date`
 * (`z.coerce.date()` parses Supabase ISO strings and Mongo `Date`s alike).
 */

import { z } from "zod";

/**
 * Built-in membership roles. `role` is stored as an extensible free string so a
 * fork can add its own roles; `admin` and `user` are the built-ins.
 */
export const ORG_ROLES = {
  admin: "admin",
  user: "user",
} as const;
export type BuiltInRole = (typeof ORG_ROLES)[keyof typeof ORG_ROLES];

export const roleSchema = z.string().min(1);
export type OrgRole = z.infer<typeof roleSchema>;

/* -------------------------------------------------------------------------- */
/* User (global identity)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Account lifecycle states. `suspended`/`banned` block login but retain data
 * (admin actions); `pending_deletion` marks the 30-day soft-delete window
 * before PII is hard-deleted.
 */
export const USER_STATUSES = {
  active: "active",
  suspended: "suspended",
  banned: "banned",
  pending_deletion: "pending_deletion",
} as const;
export type UserStatus = (typeof USER_STATUSES)[keyof typeof USER_STATUSES];
export const userStatusSchema = z.enum([
  USER_STATUSES.active,
  USER_STATUSES.suspended,
  USER_STATUSES.banned,
  USER_STATUSES.pending_deletion,
]);

export const userSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string().nullable().optional(),
  /**
   * Platform-level super-admin flag (CLAUDE.md §14). This lives on the user
   * record itself — NOT in `organization_members` — because pricing/billing are
   * platform concerns, independent of any org membership or org role. Never gate
   * it behind `multiTenant`.
   */
  isSuperAdmin: z.boolean().default(false),
  /**
   * Platform-level support-admin flag — a second, more limited admin tier
   * (view users, issue refunds, respond to tickets; cannot delete users, edit
   * pricing, or create admins). Independent of org roles, like isSuperAdmin.
   */
  isSupportAdmin: z.boolean().default(false),
  status: userStatusSchema.default(USER_STATUSES.active),
  /** Set when the user verifies their email; gates the one-per-email trial. */
  emailVerifiedAt: z.coerce.date().nullable().optional(),
  /** Set once when the free trial is started — one trial per verified email. */
  trialUsedAt: z.coerce.date().nullable().optional(),
  /** When the 30-day soft-delete window started (status=pending_deletion). */
  deletedAt: z.coerce.date().nullable().optional(),
  /** Marketing emails — on by default at signup; unsubscribe flips it off. */
  marketingEmailsEnabled: z.boolean().default(true),
  /** Token embedded in marketing-email unsubscribe links (CAN-SPAM). */
  unsubscribeToken: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type User = z.infer<typeof userSchema>;

export const newUserSchema = z.object({
  /** Optional explicit id (unused by the Mongo adapter — it generates one). */
  id: z.string().optional(),
  email: z.email(),
  name: z.string().nullable().optional(),
  /** Generated at signup by the business layer for unsubscribe links. */
  unsubscribeToken: z.string().nullable().optional(),
});
export type NewUser = z.infer<typeof newUserSchema>;

/**
 * Users are never *created* as super-admin (not in `newUserSchema`), but can be
 * promoted afterwards — e.g. the seed script promoting `SUPER_ADMIN_EMAIL`.
 */
export const updateUserSchema = newUserSchema.partial().extend({
  isSuperAdmin: z.boolean().optional(),
  isSupportAdmin: z.boolean().optional(),
  status: userStatusSchema.optional(),
  emailVerifiedAt: z.coerce.date().nullable().optional(),
  trialUsedAt: z.coerce.date().nullable().optional(),
  deletedAt: z.coerce.date().nullable().optional(),
  marketingEmailsEnabled: z.boolean().optional(),
});
export type UpdateUser = z.infer<typeof updateUserSchema>;

/* -------------------------------------------------------------------------- */
/* Organization (tenant boundary)                                             */
/* -------------------------------------------------------------------------- */

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  /**
   * Billing linkage (Phase 5). The org is the billing entity — subscriptions are
   * org-scoped and `stripeCustomerId` ties this org to its Stripe customer.
   * `trialEndsAt` is computed at org creation from `app_settings.trialDays`.
   * Both are null until payments is configured/used.
   */
  stripeCustomerId: z.string().nullable().optional(),
  trialEndsAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const newOrganizationSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  /** Set at creation from `app_settings.trialDays` (null when payments is off). */
  trialEndsAt: z.coerce.date().nullable().optional(),
});
export type NewOrganization = z.infer<typeof newOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  stripeCustomerId: z.string().nullable().optional(),
  trialEndsAt: z.coerce.date().nullable().optional(),
});
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;

/* -------------------------------------------------------------------------- */
/* OrganizationMember (tenant-scoped: carries organization_id)                */
/* -------------------------------------------------------------------------- */

export const organizationMemberSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: roleSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const newOrganizationMemberSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  role: roleSchema.default(ORG_ROLES.user),
});
export type NewOrganizationMember = z.infer<typeof newOrganizationMemberSchema>;

/* -------------------------------------------------------------------------- */
/* Invitation (tenant-scoped: carries organization_id)                        */
/* -------------------------------------------------------------------------- */

/**
 * Email-based org invitations (multi-tenant UX). An invite is created `pending`
 * with a random token; accepting it turns the invitee into a member. Tokens are
 * single-use — status moves to `accepted` (used) or `revoked` (withdrawn).
 */
export const INVITATION_STATUSES = {
  pending: "pending",
  accepted: "accepted",
  revoked: "revoked",
} as const;
export type InvitationStatus =
  (typeof INVITATION_STATUSES)[keyof typeof INVITATION_STATUSES];
export const invitationStatusSchema = z.enum([
  INVITATION_STATUSES.pending,
  INVITATION_STATUSES.accepted,
  INVITATION_STATUSES.revoked,
]);

export const invitationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.email(),
  role: roleSchema,
  token: z.string(),
  status: invitationStatusSchema,
  invitedByUserId: z.string(),
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/**
 * `token`, `expiresAt`, and the initial `status` are generated by the business
 * layer (`lib/org/invitations.ts`), not the caller.
 */
export const newInvitationSchema = z.object({
  organizationId: z.string(),
  email: z.email(),
  role: roleSchema.default(ORG_ROLES.user),
  token: z.string(),
  status: invitationStatusSchema.default(INVITATION_STATUSES.pending),
  invitedByUserId: z.string(),
  expiresAt: z.coerce.date(),
});
export type NewInvitation = z.infer<typeof newInvitationSchema>;

/* -------------------------------------------------------------------------- */
/* Plan (PLATFORM-LEVEL — the one intentional non-tenant table, §15/§1.3)     */
/* -------------------------------------------------------------------------- */

/**
 * Pricing plans belong to the PLATFORM, not to any tenant — so `plans` has NO
 * `organization_id`. This is the sole, deliberate exception to the
 * multi-tenant-by-default rule (§1.3), called out in CLAUDE.md §15.
 *
 * Monetary amounts are integer MINOR units (cents), matching Stripe's
 * `unit_amount`. `priceAnnual`/`annualDiscountPercent` are only meaningful when
 * `features.payments.annualBilling` is on; they stay null otherwise (no schema
 * change to toggle — §15). `limits` is the JSON entitlements blob read by
 * `hasAccess()`. The `stripe*` ids are managed by the payments adapter; because
 * Stripe Prices are immutable, a price change creates a NEW Price and relinks
 * these ids (never mutates one in place — §15).
 */
/** Stable slugs for the plans code needs to find without name-matching. */
export const PLAN_SLUGS = {
  free: "free",
  starter: "starter",
  pro: "pro",
  premium: "premium",
} as const;
export type PlanSlug = (typeof PLAN_SLUGS)[keyof typeof PLAN_SLUGS];

export const planSchema = z.object({
  id: z.string(),
  /** Unique, stable machine identifier (e.g. "free", "pro") — names/prices are
   * admin-editable, slugs are not. */
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  priceMonthly: z.number().int().nonnegative(),
  priceAnnual: z.number().int().nonnegative().nullable().optional(),
  annualDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  /** Entitlements/quotas JSON, read by `hasAccess()` (§15). */
  limits: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  stripeProductId: z.string().nullable().optional(),
  stripePriceIdMonthly: z.string().nullable().optional(),
  stripePriceIdAnnual: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Plan = z.infer<typeof planSchema>;

export const newPlanSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  priceMonthly: z.number().int().nonnegative(),
  priceAnnual: z.number().int().nonnegative().nullable().optional(),
  annualDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  limits: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  stripeProductId: z.string().nullable().optional(),
  stripePriceIdMonthly: z.string().nullable().optional(),
  stripePriceIdAnnual: z.string().nullable().optional(),
});
export type NewPlan = z.infer<typeof newPlanSchema>;

export const updatePlanSchema = newPlanSchema.partial();
export type UpdatePlan = z.infer<typeof updatePlanSchema>;

/* -------------------------------------------------------------------------- */
/* AppSettings (PLATFORM-LEVEL singleton — admin-editable platform config)     */
/* -------------------------------------------------------------------------- */

/**
 * Platform-wide, admin-editable settings — a single row. `trialDays` is the
 * length of ApplyNinjaa's no-card free trial (started at email verification —
 * lib/payments/trials.ts); 0 disables trials. No `organization_id`: like
 * `plans`, this is a platform concern, not per-tenant.
 */
export const DEFAULT_TRIAL_DAYS = 7;

export const appSettingsSchema = z.object({
  id: z.string(),
  trialDays: z.number().int().nonnegative().default(DEFAULT_TRIAL_DAYS),
  /**
   * ScrapperNinja lead-scoring rubric (CLAUDE.md §8 — configurable, not
   * hardcoded). The prompt DeepSeek judges each lead against in the `score`
   * job. Null falls back to a built-in default in `lib/leads/score.ts`; the
   * seed writes a sensible starter rubric so scoring is explainable out of the
   * box and editable without a deploy.
   */
  leadScoringRubric: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const updateAppSettingsSchema = z.object({
  trialDays: z.number().int().nonnegative().optional(),
  leadScoringRubric: z.string().nullable().optional(),
});
export type UpdateAppSettings = z.infer<typeof updateAppSettingsSchema>;

/* -------------------------------------------------------------------------- */
/* Subscription (tenant-scoped: carries organization_id)                      */
/* -------------------------------------------------------------------------- */

/**
 * An org's billing subscription. Org-scoped (the org is the billing entity).
 * `status` mirrors the payment provider's subscription state and is kept in sync
 * by the Stripe webhook handler. `planId` links to a platform `plans` row.
 */
export const SUBSCRIPTION_STATUSES = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
} as const;
export type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUSES)[keyof typeof SUBSCRIPTION_STATUSES];
export const subscriptionStatusSchema = z.enum([
  SUBSCRIPTION_STATUSES.trialing,
  SUBSCRIPTION_STATUSES.active,
  SUBSCRIPTION_STATUSES.past_due,
  SUBSCRIPTION_STATUSES.canceled,
  SUBSCRIPTION_STATUSES.incomplete,
]);

export const subscriptionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  planId: z.string(),
  status: subscriptionStatusSchema,
  stripeCustomerId: z.string().nullable().optional(),
  stripeSubscriptionId: z.string().nullable().optional(),
  currentPeriodEnd: z.coerce.date().nullable().optional(),
  cancelAtPeriodEnd: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const newSubscriptionSchema = z.object({
  organizationId: z.string(),
  planId: z.string(),
  status: subscriptionStatusSchema.default(SUBSCRIPTION_STATUSES.trialing),
  stripeCustomerId: z.string().nullable().optional(),
  stripeSubscriptionId: z.string().nullable().optional(),
  currentPeriodEnd: z.coerce.date().nullable().optional(),
  cancelAtPeriodEnd: z.boolean().default(false),
});
export type NewSubscription = z.infer<typeof newSubscriptionSchema>;

export const updateSubscriptionSchema = z.object({
  planId: z.string().optional(),
  status: subscriptionStatusSchema.optional(),
  stripeCustomerId: z.string().nullable().optional(),
  stripeSubscriptionId: z.string().nullable().optional(),
  currentPeriodEnd: z.coerce.date().nullable().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});
export type UpdateSubscription = z.infer<typeof updateSubscriptionSchema>;

/* -------------------------------------------------------------------------- */
/* Dropdown value sets (product spec §14 — use these exact values)            */
/* -------------------------------------------------------------------------- */

export const WORK_AUTHORIZATIONS = [
  "US Citizen",
  "Green Card Holder",
  "H1-B",
  "F-1 (CPT)",
  "F-1 (OPT)",
  "F-1 (STEM OPT)",
  "H4-EAD",
  "TN Visa",
  "Requires Sponsorship (Other)",
  "Not Authorized to Work in US",
] as const;
export const workAuthorizationSchema = z.enum(WORK_AUTHORIZATIONS);
export type WorkAuthorization = z.infer<typeof workAuthorizationSchema>;

export const WORK_ARRANGEMENTS = [
  "Remote",
  "Hybrid",
  "Onsite",
  "Flexible/Any",
] as const;
export const workArrangementSchema = z.enum(WORK_ARRANGEMENTS);
export type WorkArrangement = z.infer<typeof workArrangementSchema>;

export const EMPLOYMENT_TYPES = [
  "Full-Time",
  "Part-Time",
  "Contract",
  "Contract-to-Hire",
  "Internship",
] as const;
export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

export const APPLICATION_STATUSES = [
  "Saved",
  "Applied",
  "OA/Assessment",
  "Phone Screen",
  "Interview",
  "Final Round",
  "Offer",
  "Rejected",
  "Withdrawn",
  "Ghosted",
] as const;
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Profile (tenant-scoped: carries organization_id; multiple per user)        */
/* -------------------------------------------------------------------------- */

export const profileContactSchema = z.object({
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
});
export type ProfileContact = z.infer<typeof profileContactSchema>;

export const profileExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string().nullable().optional(),
  /** Free-form ("Jun 2022") — resumes rarely parse to exact dates. */
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  current: z.boolean().default(false),
  description: z.string().nullable().optional(),
});
export type ProfileExperience = z.infer<typeof profileExperienceSchema>;

export const profileEducationSchema = z.object({
  school: z.string(),
  degree: z.string().nullable().optional(),
  field: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  gpa: z.string().nullable().optional(),
});
export type ProfileEducation = z.infer<typeof profileEducationSchema>;

export const profileProjectSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  technologies: z.array(z.string()).default([]),
});
export type ProfileProject = z.infer<typeof profileProjectSchema>;

/**
 * A user-authored question/answer pair, e.g. "Why do you want to work here?"
 * → their standard answer. Quick Fill matches these by label BEFORE any
 * heuristic, because a hand-written answer always beats a guess.
 */
export const profileCustomFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
});
export type ProfileCustomField = z.infer<typeof profileCustomFieldSchema>;

export const profileLinksSchema = z.object({
  linkedin: z.string().nullable().optional(),
  github: z.string().nullable().optional(),
  portfolio: z.string().nullable().optional(),
  other: z.string().nullable().optional(),
});
export type ProfileLinks = z.infer<typeof profileLinksSchema>;

/**
 * EEO/demographic data — stored ONLY as field-level-encrypted ciphertext
 * (lib/crypto/field-encryption.ts). The strings here are packed ciphertext,
 * never plaintext; only the profile service encrypts/decrypts. `consentGivenAt`
 * records the explicit consent that allowed collection. A null `eeo` object
 * means no consent was given.
 */
export const profileEeoSchema = z.object({
  consentGivenAt: z.coerce.date(),
  gender: z.string().nullable().optional(),
  raceEthnicity: z.string().nullable().optional(),
  veteranStatus: z.string().nullable().optional(),
  disabilityStatus: z.string().nullable().optional(),
});
export type ProfileEeo = z.infer<typeof profileEeoSchema>;

export const profileSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  /** User-facing profile name, e.g. "Frontend", "Backend/AI". */
  name: z.string().min(1),
  contact: profileContactSchema.default({}),
  summary: z.string().nullable().optional(),
  skills: z.array(z.string()).default([]),
  experience: z.array(profileExperienceSchema).default([]),
  education: z.array(profileEducationSchema).default([]),
  projects: z.array(profileProjectSchema).default([]),
  customFields: z.array(profileCustomFieldSchema).default([]),
  /** Free-text background the AI may draw on for open-ended questions. */
  knowledgeBase: z.string().default(""),
  links: profileLinksSchema.default({}),
  workAuthorization: workAuthorizationSchema.nullable().optional(),
  workArrangement: workArrangementSchema.nullable().optional(),
  employmentTypes: z.array(employmentTypeSchema).default([]),
  salaryExpectation: z.string().nullable().optional(),
  eeo: profileEeoSchema.nullable().optional(),
  isDefault: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Profile = z.infer<typeof profileSchema>;

export const newProfileSchema = profileSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewProfile = z.infer<typeof newProfileSchema>;

export const updateProfileSchema = newProfileSchema
  .omit({ organizationId: true, userId: true })
  .partial();
export type UpdateProfile = z.infer<typeof updateProfileSchema>;

/* -------------------------------------------------------------------------- */
/* ProfileDomainPref (remember last-used profile per job-site domain)         */
/* -------------------------------------------------------------------------- */

export const profileDomainPrefSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  /** Hostname, e.g. "boards.greenhouse.io". Unique per (userId, domain). */
  domain: z.string().min(1),
  profileId: z.string(),
  lastUsedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ProfileDomainPref = z.infer<typeof profileDomainPrefSchema>;

/* -------------------------------------------------------------------------- */
/* Application (tenant-scoped: carries organization_id)                       */
/* -------------------------------------------------------------------------- */

export const FILTER_VERDICTS = ["Yes", "No", "Neutral"] as const;
export const filterVerdictSchema = z.enum(FILTER_VERDICTS);
export type FilterVerdict = z.infer<typeof filterVerdictSchema>;

/** One filter's AI evaluation snapshot, denormalized onto the application. */
export const applicationFilterResultSchema = z.object({
  filterId: z.string().nullable().optional(),
  label: z.string(),
  verdict: filterVerdictSchema,
});
export type ApplicationFilterResult = z.infer<
  typeof applicationFilterResultSchema
>;

/**
 * One extra page attached to an already-tracked application — the same job
 * seen on a second site (LinkedIn listing → company careers page), or the
 * confirmation page after submitting. The FIRST link tracked stays the
 * primary `url`/`domain` so existing rows and the dashboard keep working.
 */
export const applicationLinkSchema = z.object({
  url: z.string(),
  domain: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  addedAt: z.coerce.date(),
});
export type ApplicationLink = z.infer<typeof applicationLinkSchema>;

export const applicationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  profileId: z.string().nullable().optional(),
  company: z.string().min(1),
  roleTitle: z.string().min(1),
  url: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  /** Derived from the hostname, e.g. "LinkedIn" | "Greenhouse" | "Company site". */
  platform: z.string().nullable().optional(),
  additionalLinks: z.array(applicationLinkSchema).default([]),
  status: applicationStatusSchema.default("Applied"),
  /** 0-100. AI-generated but user-editable — the user's value wins. */
  fitScore: z.number().min(0).max(100).nullable().optional(),
  fitReasoning: z.string().nullable().optional(),
  filterResults: z.array(applicationFilterResultSchema).default([]),
  appliedAt: z.coerce.date(),
  notes: z.string().default(""),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Application = z.infer<typeof applicationSchema>;

export const newApplicationSchema = applicationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewApplication = z.infer<typeof newApplicationSchema>;

export const updateApplicationSchema = newApplicationSchema
  .omit({ organizationId: true, userId: true })
  .partial();
export type UpdateApplication = z.infer<typeof updateApplicationSchema>;

/* -------------------------------------------------------------------------- */
/* JobFilter (admin master list + per-user custom filters)                    */
/* -------------------------------------------------------------------------- */

export const JOB_FILTER_TYPES = {
  admin: "admin",
  user: "user",
} as const;
export type JobFilterType =
  (typeof JOB_FILTER_TYPES)[keyof typeof JOB_FILTER_TYPES];
export const jobFilterTypeSchema = z.enum([
  JOB_FILTER_TYPES.admin,
  JOB_FILTER_TYPES.user,
]);

/**
 * A "Valid Job" filter the AI evaluates a job description against
 * (Yes/No/Neutral). `admin` filters are platform-wide defaults managed in the
 * admin dashboard (no ownerId); `user` filters belong to one user.
 */
export const jobFilterSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  type: jobFilterTypeSchema,
  ownerId: z.string().nullable().optional(),
  /** Optional guidance appended to the AI classification prompt. */
  description: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type JobFilter = z.infer<typeof jobFilterSchema>;

export const newJobFilterSchema = jobFilterSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewJobFilter = z.infer<typeof newJobFilterSchema>;

export const updateJobFilterSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateJobFilter = z.infer<typeof updateJobFilterSchema>;

/* -------------------------------------------------------------------------- */
/* UserFilterSetting (which filters a user has toggled on)                    */
/* -------------------------------------------------------------------------- */

export const userFilterSettingSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  filterId: z.string(),
  enabled: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type UserFilterSetting = z.infer<typeof userFilterSettingSchema>;

/* -------------------------------------------------------------------------- */
/* AdminAction (audit log — who, what, when, why)                             */
/* -------------------------------------------------------------------------- */

export const ADMIN_ACTIONS = [
  "refund_full",
  "refund_partial",
  "suspend_user",
  "unsuspend_user",
  "ban_user",
  "delete_user",
  "cancel_subscription",
  "assign_plan",
  "plan_create",
  "plan_update",
  "plan_delete",
  "filter_create",
  "filter_update",
  "filter_delete",
  "settings_update",
] as const;
export const adminActionTypeSchema = z.enum(ADMIN_ACTIONS);
export type AdminActionType = z.infer<typeof adminActionTypeSchema>;

export const adminActionSchema = z.object({
  id: z.string(),
  actorUserId: z.string(),
  actorRole: z.enum(["super_admin", "support_admin"]),
  action: adminActionTypeSchema,
  targetUserId: z.string().nullable().optional(),
  /** Non-user target (plan id, filter id, subscription id...). */
  targetId: z.string().nullable().optional(),
  /** Required for refunds/suspend/ban/delete — enforced at the route layer. */
  reason: z.string().default(""),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.coerce.date(),
});
export type AdminAction = z.infer<typeof adminActionSchema>;

export const newAdminActionSchema = adminActionSchema.omit({
  id: true,
  createdAt: true,
});
export type NewAdminAction = z.infer<typeof newAdminActionSchema>;

/* -------------------------------------------------------------------------- */
/* GmailScan (manual, user-approved inbox scans)                              */
/* -------------------------------------------------------------------------- */

export const GMAIL_SCAN_STATUSES = {
  running: "running",
  ready: "ready",
  failed: "failed",
} as const;
export type GmailScanStatus =
  (typeof GMAIL_SCAN_STATUSES)[keyof typeof GMAIL_SCAN_STATUSES];
export const gmailScanStatusSchema = z.enum([
  GMAIL_SCAN_STATUSES.running,
  GMAIL_SCAN_STATUSES.ready,
  GMAIL_SCAN_STATUSES.failed,
]);

export const EMAIL_CLASSIFICATIONS = [
  "interview",
  "rejection",
  "offer",
  "assessment",
  "other",
] as const;
export const emailClassificationSchema = z.enum(EMAIL_CLASSIFICATIONS);
export type EmailClassification = z.infer<typeof emailClassificationSchema>;

/**
 * One classified email + its proposed application update. Nothing is written
 * to an application until the user sets `decision: "approved"` — no silent
 * auto-updates.
 */
export const gmailScanProposalSchema = z.object({
  messageId: z.string(),
  from: z.string(),
  subject: z.string(),
  receivedAt: z.coerce.date().nullable().optional(),
  excerpt: z.string().default(""),
  classification: emailClassificationSchema,
  matchedApplicationId: z.string().nullable().optional(),
  suggestedStatus: applicationStatusSchema.nullable().optional(),
  decision: z.enum(["approved", "rejected"]).nullable().default(null),
});
export type GmailScanProposal = z.infer<typeof gmailScanProposalSchema>;

export const gmailScanSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  rangeFrom: z.coerce.date(),
  rangeTo: z.coerce.date(),
  status: gmailScanStatusSchema.default(GMAIL_SCAN_STATUSES.running),
  error: z.string().nullable().optional(),
  proposals: z.array(gmailScanProposalSchema).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type GmailScan = z.infer<typeof gmailScanSchema>;

export const newGmailScanSchema = gmailScanSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewGmailScan = z.infer<typeof newGmailScanSchema>;

export const updateGmailScanSchema = z.object({
  status: gmailScanStatusSchema.optional(),
  error: z.string().nullable().optional(),
  proposals: z.array(gmailScanProposalSchema).optional(),
});
export type UpdateGmailScan = z.infer<typeof updateGmailScanSchema>;

/* ========================================================================== */
/* ScrapperNinja — leads, campaigns, sources, saved views, custom fields      */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Lead value sets (spec §14 — use these exact values)                        */
/* -------------------------------------------------------------------------- */

/** Workflow status of a lead as it moves from capture to export. */
export const LEAD_STATUSES = [
  "new",
  "needs_review",
  "ready",
  "exported",
  "junk",
  "archived",
] as const;
export const leadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

/** Where a lead originated. */
export const LEAD_SOURCE_TYPES = [
  "google_maps",
  "generic_web",
  "manual",
  "csv",
] as const;
export const leadSourceTypeSchema = z.enum(LEAD_SOURCE_TYPES);
export type LeadSourceType = z.infer<typeof leadSourceTypeSchema>;

/** Outreach automation tier a lead qualifies for (a = highest touch). */
export const AUTOMATION_TIERS = ["a", "b", "c", "d"] as const;
export const automationTierSchema = z.enum(AUTOMATION_TIERS);
export type AutomationTier = z.infer<typeof automationTierSchema>;

/** Whether the business has a usable website. */
export const WEBSITE_STATUSES = ["has", "none", "bad", "unknown"] as const;
export const websiteStatusSchema = z.enum(WEBSITE_STATUSES);
export type WebsiteStatus = z.infer<typeof websiteStatusSchema>;

/** Rough size bucket of the business. */
export const BUSINESS_SIZES = [
  "solo",
  "small",
  "medium",
  "large",
  "unknown",
] as const;
export const businessSizeSchema = z.enum(BUSINESS_SIZES);
export type BusinessSize = z.infer<typeof businessSizeSchema>;

/** Lifecycle of the async enrichment pass over a lead. */
export const ENRICHMENT_STATUSES = [
  "pending",
  "running",
  "done",
  "failed",
  "skipped",
] as const;
export const enrichmentStatusSchema = z.enum(ENRICHMENT_STATUSES);
export type EnrichmentStatus = z.infer<typeof enrichmentStatusSchema>;

/** Campaign lifecycle. */
export const CAMPAIGN_STATUSES = ["active", "archived"] as const;
export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

/** Data type of a user-defined lead custom field. */
export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "boolean",
] as const;
export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

/* -------------------------------------------------------------------------- */
/* Lead (tenant-scoped: carries organization_id)                              */
/* -------------------------------------------------------------------------- */

/** Postal address captured from the source; every part is best-effort/nullable. */
export const leadAddressSchema = z.object({
  raw: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
});
export type LeadAddress = z.infer<typeof leadAddressSchema>;

/** Social profile URLs discovered during enrichment. */
export const leadSocialsSchema = z.object({
  facebook: z.string().nullable().optional(),
  instagram: z.string().nullable().optional(),
  linkedin: z.string().nullable().optional(),
  x: z.string().nullable().optional(),
  youtube: z.string().nullable().optional(),
  tiktok: z.string().nullable().optional(),
});
export type LeadSocials = z.infer<typeof leadSocialsSchema>;

/** PageSpeed scores (0-100) for the business website, mobile + desktop. */
export const leadPageSpeedSchema = z.object({
  mobile: z.number().nullable().optional(),
  desktop: z.number().nullable().optional(),
});
export type LeadPageSpeed = z.infer<typeof leadPageSpeedSchema>;

export const leadSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  /* -- identity ------------------------------------------------------------ */
  campaignIds: z.array(z.string()).default([]),
  sourceType: leadSourceTypeSchema,
  sourceUrl: z.string().nullable().optional(),
  capturedAt: z.coerce.date(),
  capturedByUserId: z.string().nullable().optional(),
  /** Client-generated idempotency key for capture (unique per org, sparse). */
  clientCaptureId: z.string().nullable().optional(),
  /** The `capture_sessions` run this lead was first captured in, when known.
   * Powers the /leads?sessionId=… drill-down from the sessions table. */
  captureSessionId: z.string().nullable().optional(),
  /* -- captured ------------------------------------------------------------ */
  businessName: z.string().min(1),
  category: z.string().nullable().optional(),
  categories: z.array(z.string()).default([]),
  phone: z.string().nullable().optional(),
  phoneE164: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  websiteDomain: z.string().nullable().optional(),
  address: leadAddressSchema.default({}),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  reviewCount: z.number().nullable().optional(),
  priceLevel: z.number().nullable().optional(),
  hours: z.string().nullable().optional(),
  plusCode: z.string().nullable().optional(),
  /* -- enriched ------------------------------------------------------------ */
  ownerName: z.string().nullable().optional(),
  emails: z.array(z.string()).default([]),
  socials: leadSocialsSchema.default({}),
  techStack: z.array(z.string()).default([]),
  pageSpeed: leadPageSpeedSchema.default({}),
  businessSize: businessSizeSchema.default("unknown"),
  industrySubType: z.string().nullable().optional(),
  websiteStatus: websiteStatusSchema.default("unknown"),
  enrichmentStatus: z.string().nullable().optional(),
  enrichedAt: z.coerce.date().nullable().optional(),
  /* -- generated ----------------------------------------------------------- */
  offerLine: z.string().nullable().optional(),
  offerLineEditedAt: z.coerce.date().nullable().optional(),
  offerLinePromptId: z.string().nullable().optional(),
  score: z.number().min(0).max(100).nullable().optional(),
  scoreReasoning: z.string().nullable().optional(),
  /* -- workflow ------------------------------------------------------------ */
  status: leadStatusSchema.default("new"),
  notes: z.string().default(""),
  customFields: z.record(z.string(), z.unknown()).default({}),
  parseIssues: z.array(z.string()).default([]),
  rawSnippet: z.string().nullable().optional(),
  dedupeKeys: z.array(z.string()).default([]),
  mergedIntoId: z.string().nullable().optional(),
  exportedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  /** Soft-delete marker — set instead of removing the row. */
  deletedAt: z.coerce.date().nullable().optional(),
});
export type Lead = z.infer<typeof leadSchema>;

export const newLeadSchema = leadSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewLead = z.infer<typeof newLeadSchema>;

export const updateLeadSchema = newLeadSchema
  .omit({ organizationId: true })
  .partial();
export type UpdateLead = z.infer<typeof updateLeadSchema>;

/* -------------------------------------------------------------------------- */
/* Campaign (tenant-scoped: carries organization_id)                          */
/* -------------------------------------------------------------------------- */

export const campaignSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  query: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  sourceType: leadSourceTypeSchema.nullable().optional(),
  status: campaignStatusSchema.default("active"),
  /** Denormalized count kept in sync via `incrementCampaignLeadCount`. */
  leadCount: z.number().int().nonnegative().default(0),
  createdByUserId: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Campaign = z.infer<typeof campaignSchema>;

export const newCampaignSchema = campaignSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewCampaign = z.infer<typeof newCampaignSchema>;

export const updateCampaignSchema = newCampaignSchema
  .omit({ organizationId: true, createdByUserId: true })
  .partial();
export type UpdateCampaign = z.infer<typeof updateCampaignSchema>;

/* -------------------------------------------------------------------------- */
/* LeadSource (tenant-scoped: raw provenance for each captured lead)          */
/* -------------------------------------------------------------------------- */

export const leadSourceSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  leadId: z.string(),
  sourceType: leadSourceTypeSchema,
  sourceUrl: z.string().nullable().optional(),
  campaignId: z.string().nullable().optional(),
  capturedAt: z.coerce.date(),
  /** Untouched provider payload (Google Maps JSON, scraped DOM, CSV row…). */
  rawPayload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type LeadSource = z.infer<typeof leadSourceSchema>;

export const newLeadSourceSchema = leadSourceSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewLeadSource = z.infer<typeof newLeadSourceSchema>;

export const updateLeadSourceSchema = newLeadSourceSchema
  .omit({ organizationId: true, leadId: true })
  .partial();
export type UpdateLeadSource = z.infer<typeof updateLeadSourceSchema>;

/* -------------------------------------------------------------------------- */
/* SavedView (tenant-scoped: a user's saved leads table configuration)        */
/* -------------------------------------------------------------------------- */

export const savedViewSortSchema = z.object({
  key: z.string(),
  dir: z.enum(["asc", "desc"]),
});
export type SavedViewSort = z.infer<typeof savedViewSortSchema>;

/** Allowed page sizes for the leads table. */
export const SAVED_VIEW_PAGE_SIZES = [25, 50, 100, 250] as const;
export const savedViewPageSizeSchema = z.union([
  z.literal(25),
  z.literal(50),
  z.literal(100),
  z.literal(250),
]);
export type SavedViewPageSize = z.infer<typeof savedViewPageSizeSchema>;

export const savedViewSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  name: z.string().min(1),
  columns: z.array(z.string()).default([]),
  filters: z.record(z.string(), z.unknown()).default({}),
  sort: savedViewSortSchema.default({ key: "createdAt", dir: "desc" }),
  pageSize: savedViewPageSizeSchema.default(25),
  isDefault: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SavedView = z.infer<typeof savedViewSchema>;

export const newSavedViewSchema = savedViewSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewSavedView = z.infer<typeof newSavedViewSchema>;

export const updateSavedViewSchema = newSavedViewSchema
  .omit({ organizationId: true, userId: true })
  .partial();
export type UpdateSavedView = z.infer<typeof updateSavedViewSchema>;

/* -------------------------------------------------------------------------- */
/* LeadCustomField (tenant-scoped: per-org custom column definitions)         */
/* -------------------------------------------------------------------------- */

export const leadCustomFieldSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  /** Machine slug used as the key inside a lead's `customFields` map. */
  key: z.string().min(1),
  label: z.string().min(1),
  type: customFieldTypeSchema,
  /** Choices for `select`-type fields; empty for other types. */
  options: z.array(z.string()).default([]),
  sortOrder: z.number().int().default(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type LeadCustomField = z.infer<typeof leadCustomFieldSchema>;

export const newLeadCustomFieldSchema = leadCustomFieldSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewLeadCustomField = z.infer<typeof newLeadCustomFieldSchema>;

export const updateLeadCustomFieldSchema = newLeadCustomFieldSchema
  .omit({ organizationId: true })
  .partial();
export type UpdateLeadCustomField = z.infer<typeof updateLeadCustomFieldSchema>;

/* ========================================================================== */
/* ScrapperNinja Phase 2 — source packs & capture sessions                    */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/* SourcePack (PLATFORM-LEVEL — no organizationId, like plans, §15)           */
/* -------------------------------------------------------------------------- */

/**
 * A server-pushed selector pack for one capture source (e.g. Google Maps). Like
 * `plans`, this is a PLATFORM concern — the same DOM selectors serve every
 * tenant's extension — so it carries NO `organization_id` (the deliberate §1.3
 * exception, called out in CLAUDE.md §15). The extension fetches the active
 * packs at each capture start and caches them by `version`, falling back to its
 * bundled selectors when the fetch fails. `selectors` is a flat map of a logical
 * field name (e.g. `name`, `phone`) to a CSS selector string.
 */
export const sourcePackSchema = z.object({
  id: z.string(),
  /** Stable machine id of the capture source, e.g. "google-maps". */
  sourceId: z.string().min(1),
  /** Bumped on every selector edit so the extension can cache-invalidate. */
  version: z.number().int().nonnegative().default(1),
  automationTier: automationTierSchema,
  /** Logical field name → CSS selector. */
  selectors: z.record(z.string(), z.string()).default({}),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SourcePack = z.infer<typeof sourcePackSchema>;

export const newSourcePackSchema = sourcePackSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewSourcePack = z.infer<typeof newSourcePackSchema>;

/** `sourceId` is the stable lookup key — create-only, never edited afterwards. */
export const updateSourcePackSchema = newSourcePackSchema
  .omit({ sourceId: true })
  .partial();
export type UpdateSourcePack = z.infer<typeof updateSourcePackSchema>;

/* -------------------------------------------------------------------------- */
/* CaptureSession (tenant-scoped: one extension capture run)                  */
/* -------------------------------------------------------------------------- */

/** Capture fidelity — `fast` scrapes the list only; `deep` opens each result. */
export const CAPTURE_MODES = ["fast", "deep"] as const;
export const captureModeSchema = z.enum(CAPTURE_MODES);
export type CaptureMode = z.infer<typeof captureModeSchema>;

/** Lifecycle of a capture run. `stopped` = the user ended it midway (a normal,
 * non-error stop); `canceled` is reserved for a true abort. */
export const CAPTURE_SESSION_STATUSES = [
  "running",
  "completed",
  "stopped",
  "failed",
  "canceled",
] as const;
export const captureSessionStatusSchema = z.enum(CAPTURE_SESSION_STATUSES);
export type CaptureSessionStatus = z.infer<typeof captureSessionStatusSchema>;

export const captureSessionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  campaignId: z.string(),
  sourceType: leadSourceTypeSchema,
  sourceUrl: z.string().nullable().optional(),
  mode: captureModeSchema,
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable().optional(),
  capturedCount: z.number().int().nonnegative().default(0),
  needsReviewCount: z.number().int().nonnegative().default(0),
  status: captureSessionStatusSchema.default("running"),
  extensionVersion: z.string().nullable().optional(),
  createdByUserId: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CaptureSession = z.infer<typeof captureSessionSchema>;

export const newCaptureSessionSchema = captureSessionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewCaptureSession = z.infer<typeof newCaptureSessionSchema>;

export const updateCaptureSessionSchema = newCaptureSessionSchema
  .omit({ organizationId: true, createdByUserId: true })
  .partial();
export type UpdateCaptureSession = z.infer<typeof updateCaptureSessionSchema>;

/* ========================================================================== */
/* ScrapperNinja Phase 3 — batch jobs, offer prompts, duplicate candidates    */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/* BatchJob (tenant-scoped: one in-process AI/enrichment pass over leads)     */
/* -------------------------------------------------------------------------- */

/** The kind of work a batch job performs — one handler per type. */
export const BATCH_JOB_TYPES = [
  "rescue",
  "normalize",
  "dedupe",
  "label",
  "enrich",
  "score",
  "offer",
] as const;
export const batchJobTypeSchema = z.enum(BATCH_JOB_TYPES);
export type BatchJobType = z.infer<typeof batchJobTypeSchema>;

/** Lifecycle of a batch job. The in-process runner drives the transitions. */
export const BATCH_JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "canceled",
] as const;
export const batchJobStatusSchema = z.enum(BATCH_JOB_STATUSES);
export type BatchJobStatus = z.infer<typeof batchJobStatusSchema>;

export const batchJobSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  type: batchJobTypeSchema,
  status: batchJobStatusSchema.default("queued"),
  /**
   * The target set. Exactly one is meaningful: either a serialized lead query
   * (`targetFilter`, the shape produced by the query layer's params) OR an
   * explicit `leadIds` list. Both are stored so the runner can re-resolve the
   * set on resume.
   */
  targetFilter: z.record(z.string(), z.unknown()).nullable().optional(),
  leadIds: z.array(z.string()).default([]),
  /* -- progress counters (updated after each chunk) ----------------------- */
  total: z.number().int().nonnegative().default(0),
  processed: z.number().int().nonnegative().default(0),
  succeeded: z.number().int().nonnegative().default(0),
  failed: z.number().int().nonnegative().default(0),
  /** Terminal error message when `status` is `failed`. */
  error: z.string().nullable().optional(),
  /** Per-type parameters (e.g. offer `promptId`, `variants`, `skipEdited`). */
  params: z.record(z.string(), z.unknown()).default({}),
  createdByUserId: z.string(),
  startedAt: z.coerce.date().nullable().optional(),
  finishedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type BatchJob = z.infer<typeof batchJobSchema>;

export const newBatchJobSchema = batchJobSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewBatchJob = z.infer<typeof newBatchJobSchema>;

export const updateBatchJobSchema = newBatchJobSchema
  .omit({ organizationId: true, type: true, createdByUserId: true })
  .partial();
export type UpdateBatchJob = z.infer<typeof updateBatchJobSchema>;

/* -------------------------------------------------------------------------- */
/* OfferPrompt (tenant-scoped: a saved cold-email opening-line template)      */
/* -------------------------------------------------------------------------- */

/**
 * A named prompt template for generating a lead's `offerLine`. `promptText`
 * contains `{{placeholder}}` tokens resolved per lead by
 * `lib/leads/render-prompt.ts`. `provider`/`model` override the routed default
 * when set (nullable = use the routed DeepSeek default). At most one prompt per
 * org may be `isDefault` — enforced in the service layer, not the schema.
 */
export const offerPromptSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().min(1),
  promptText: z.string().min(1),
  isDefault: z.boolean().default(false),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  createdByUserId: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type OfferPrompt = z.infer<typeof offerPromptSchema>;

export const newOfferPromptSchema = offerPromptSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewOfferPrompt = z.infer<typeof newOfferPromptSchema>;

export const updateOfferPromptSchema = newOfferPromptSchema
  .omit({ organizationId: true, createdByUserId: true })
  .partial();
export type UpdateOfferPrompt = z.infer<typeof updateOfferPromptSchema>;

/* -------------------------------------------------------------------------- */
/* DuplicateCandidate (tenant-scoped: a pair the dedupe pass flagged)         */
/* -------------------------------------------------------------------------- */

/**
 * Lifecycle of a flagged duplicate pair. NOTHING merges automatically
 * (locked decision #8) — a pair stays `pending` until a human resolves it into
 * `merged` (via `lib/leads/merge.ts`) or `dismissed` ("keep both").
 */
export const DUPLICATE_CANDIDATE_STATUSES = [
  "pending",
  "merged",
  "dismissed",
] as const;
export const duplicateCandidateStatusSchema = z.enum(
  DUPLICATE_CANDIDATE_STATUSES,
);
export type DuplicateCandidateStatus = z.infer<
  typeof duplicateCandidateStatusSchema
>;

export const duplicateCandidateSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  leadAId: z.string(),
  leadBId: z.string(),
  /** Which dedupe keys the pair shares (e.g. `["phone", "domain"]`). */
  matchedOn: z.array(z.string()).default([]),
  /** Match confidence in [0, 1]. */
  confidence: z.number().min(0).max(1).default(0),
  status: duplicateCandidateStatusSchema.default("pending"),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

export const newDuplicateCandidateSchema = duplicateCandidateSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewDuplicateCandidate = z.infer<
  typeof newDuplicateCandidateSchema
>;

export const updateDuplicateCandidateSchema = z.object({
  status: duplicateCandidateStatusSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  matchedOn: z.array(z.string()).optional(),
});
export type UpdateDuplicateCandidate = z.infer<
  typeof updateDuplicateCandidateSchema
>;
