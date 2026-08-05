/**
 * lib/db/mongodb/adapter.ts — MongoDB implementation of DatabaseAdapter.
 *
 * Uses Mongoose. Every tenant-scoped collection carries an indexed
 * `organization_id` field (§1.3); membership is additionally uniquely indexed on
 * `(organization_id, user_id)`. Connection is established lazily on first query
 * and reused. Documents are mapped to the canonical camelCase domain models in
 * ../schema (Mongo stores `_id`/snake_case; the domain layer never sees them).
 */

import mongoose, { Schema, type Model } from "mongoose";

import { env } from "@/config/env.schema";
import type {
  DatabaseAdapter,
  ListAdminActionsParams,
  ListAdminActionsResult,
  ListLeadsParams,
  ListLeadsResult,
  ListUsersParams,
  ListUsersResult,
} from "../adapter";
import {
  DEFAULT_TRIAL_DAYS,
  GMAIL_SCAN_STATUSES,
  INVITATION_STATUSES,
  ORG_ROLES,
  SUBSCRIPTION_STATUSES,
  USER_STATUSES,
  newAdminActionSchema,
  newApplicationSchema,
  newBatchJobSchema,
  newCampaignSchema,
  newCaptureSessionSchema,
  newDuplicateCandidateSchema,
  newGmailScanSchema,
  newInvitationSchema,
  newJobFilterSchema,
  newLeadCustomFieldSchema,
  newLeadSchema,
  newLeadSourceSchema,
  newOfferPromptSchema,
  newOrganizationMemberSchema,
  newPlanSchema,
  newProfileSchema,
  newSavedViewSchema,
  newSourcePackSchema,
  newSubscriptionSchema,
  type AdminAction,
  type Application,
  type ApplicationFilterResult,
  type ApplicationLink,
  type ApplicationStatus,
  type AppSettings,
  type BatchJob,
  type Campaign,
  type CaptureSession,
  type DuplicateCandidate,
  type GmailScan,
  type GmailScanProposal,
  type Invitation,
  type InvitationStatus,
  type JobFilter,
  type Lead,
  type LeadAddress,
  type LeadCustomField,
  type LeadPageSpeed,
  type LeadSocials,
  type LeadSource,
  type NewAdminAction,
  type NewApplication,
  type NewBatchJob,
  type NewCampaign,
  type NewCaptureSession,
  type NewDuplicateCandidate,
  type NewGmailScan,
  type NewInvitation,
  type NewJobFilter,
  type NewLead,
  type NewLeadCustomField,
  type NewLeadSource,
  type NewOfferPrompt,
  type NewOrganization,
  type NewOrganizationMember,
  type NewPlan,
  type NewProfile,
  type NewSavedView,
  type NewSourcePack,
  type NewSubscription,
  type NewUser,
  type OfferPrompt,
  type Organization,
  type OrganizationMember,
  type OrgRole,
  type Plan,
  type Profile,
  type ProfileContact,
  type ProfileDomainPref,
  type ProfileEducation,
  type ProfileEeo,
  type ProfileExperience,
  type ProfileLinks,
  type ProfileCustomField,
  type ProfileProject,
  type SavedView,
  type SavedViewSort,
  type SourcePack,
  type Subscription,
  type UpdateApplication,
  type UpdateAppSettings,
  type UpdateBatchJob,
  type UpdateCampaign,
  type UpdateCaptureSession,
  type UpdateDuplicateCandidate,
  type UpdateGmailScan,
  type UpdateJobFilter,
  type UpdateLead,
  type UpdateLeadCustomField,
  type UpdateOfferPrompt,
  type UpdateOrganization,
  type UpdatePlan,
  type UpdateProfile,
  type UpdateSavedView,
  type UpdateSourcePack,
  type UpdateSubscription,
  type UpdateUser,
  type User,
  type UserFilterSetting,
} from "../schema";

/* -- Document shapes (as stored, incl. Mongoose-managed fields) ------------ */

interface UserDoc {
  _id: mongoose.Types.ObjectId;
  email: string;
  name: string | null;
  is_super_admin: boolean;
  is_support_admin: boolean;
  status: string;
  email_verified_at: Date | null;
  trial_used_at: Date | null;
  deleted_at: Date | null;
  marketing_emails_enabled: boolean;
  unsubscribe_token: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface OrganizationDoc {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  stripe_customer_id: string | null;
  trial_ends_at: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PlanDoc {
  _id: mongoose.Types.ObjectId;
  slug: string;
  name: string;
  description: string | null;
  price_monthly: number;
  price_annual: number | null;
  annual_discount_percent: number | null;
  limits: Record<string, unknown>;
  is_active: boolean;
  sort_order: number;
  stripe_product_id: string | null;
  stripe_price_id_monthly: string | null;
  stripe_price_id_annual: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AppSettingsDoc {
  _id: mongoose.Types.ObjectId;
  key: string;
  trial_days: number;
  lead_scoring_rubric: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SubscriptionDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  plan_id: mongoose.Types.ObjectId;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface OrganizationMemberDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

interface InvitationDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  email: string;
  role: string;
  token: string;
  status: string;
  invited_by_user_id: mongoose.Types.ObjectId;
  expires_at: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface ProfileDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  name: string;
  contact: ProfileContact;
  summary: string | null;
  skills: string[];
  experience: ProfileExperience[];
  education: ProfileEducation[];
  projects: ProfileProject[];
  custom_fields: ProfileCustomField[];
  knowledge_base: string;
  links: ProfileLinks;
  work_authorization: string | null;
  work_arrangement: string | null;
  employment_types: string[];
  salary_expectation: string | null;
  // EEO fields hold packed ciphertext (field-level encryption), never plaintext.
  eeo: ProfileEeo | null;
  is_default: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ProfileDomainPrefDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  domain: string;
  profile_id: mongoose.Types.ObjectId;
  last_used_at: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface ApplicationDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  profile_id: mongoose.Types.ObjectId | null;
  company: string;
  role_title: string;
  url: string | null;
  domain: string | null;
  platform: string | null;
  additional_links: ApplicationLink[];
  status: string;
  fit_score: number | null;
  fit_reasoning: string | null;
  filter_results: ApplicationFilterResult[];
  applied_at: Date;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

interface JobFilterDoc {
  _id: mongoose.Types.ObjectId;
  label: string;
  type: string;
  owner_id: mongoose.Types.ObjectId | null;
  description: string | null;
  is_active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface UserFilterSettingDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  filter_id: mongoose.Types.ObjectId;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface AdminActionDoc {
  _id: mongoose.Types.ObjectId;
  actor_user_id: mongoose.Types.ObjectId;
  actor_role: string;
  action: string;
  target_user_id: mongoose.Types.ObjectId | null;
  target_id: string | null;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface GmailScanDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  range_from: Date;
  range_to: Date;
  status: string;
  error: string | null;
  proposals: GmailScanProposal[];
  createdAt: Date;
  updatedAt: Date;
}

interface LeadDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  // identity
  campaign_ids: mongoose.Types.ObjectId[];
  source_type: string;
  source_url: string | null;
  captured_at: Date;
  captured_by_user_id: mongoose.Types.ObjectId | null;
  client_capture_id: string | null;
  capture_session_id: mongoose.Types.ObjectId | null;
  // captured
  business_name: string;
  category: string | null;
  categories: string[];
  phone: string | null;
  phone_e164: string | null;
  website: string | null;
  website_domain: string | null;
  address: LeadAddress;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  review_count: number | null;
  price_level: number | null;
  hours: string | null;
  plus_code: string | null;
  // enriched
  owner_name: string | null;
  emails: string[];
  socials: LeadSocials;
  tech_stack: string[];
  page_speed: LeadPageSpeed;
  business_size: string;
  industry_sub_type: string | null;
  website_status: string;
  enrichment_status: string | null;
  enriched_at: Date | null;
  // generated
  offer_line: string | null;
  offer_line_edited_at: Date | null;
  offer_line_prompt_id: string | null;
  score: number | null;
  score_reasoning: string | null;
  // workflow
  status: string;
  notes: string;
  custom_fields: Record<string, unknown>;
  parse_issues: string[];
  raw_snippet: string | null;
  dedupe_keys: string[];
  merged_into_id: mongoose.Types.ObjectId | null;
  exported_at: Date | null;
  deleted_at: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CampaignDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  name: string;
  description: string | null;
  query: string | null;
  location: string | null;
  source_type: string | null;
  status: string;
  lead_count: number;
  created_by_user_id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

interface LeadSourceDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  lead_id: mongoose.Types.ObjectId;
  source_type: string;
  source_url: string | null;
  campaign_id: mongoose.Types.ObjectId | null;
  captured_at: Date;
  raw_payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface SavedViewDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  name: string;
  columns: string[];
  filters: Record<string, unknown>;
  sort: SavedViewSort;
  page_size: number;
  is_default: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface LeadCustomFieldDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  key: string;
  label: string;
  type: string;
  options: string[];
  sort_order: number;
  createdAt: Date;
  updatedAt: Date;
}

// Source packs are PLATFORM-level — no organization_id (§15).
interface SourcePackDoc {
  _id: mongoose.Types.ObjectId;
  source_id: string;
  version: number;
  automation_tier: string;
  selectors: Record<string, string>;
  notes: string | null;
  is_active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CaptureSessionDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  campaign_id: mongoose.Types.ObjectId;
  source_type: string;
  source_url: string | null;
  mode: string;
  started_at: Date;
  ended_at: Date | null;
  captured_count: number;
  needs_review_count: number;
  status: string;
  extension_version: string | null;
  created_by_user_id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

interface BatchJobDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  type: string;
  status: string;
  target_filter: Record<string, unknown> | null;
  lead_ids: string[];
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  error: string | null;
  params: Record<string, unknown>;
  created_by_user_id: mongoose.Types.ObjectId;
  started_at: Date | null;
  finished_at: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface OfferPromptDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  name: string;
  prompt_text: string;
  is_default: boolean;
  provider: string | null;
  model: string | null;
  created_by_user_id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

interface DuplicateCandidateDoc {
  _id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  lead_a_id: mongoose.Types.ObjectId;
  lead_b_id: mongoose.Types.ObjectId;
  matched_on: string[];
  confidence: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/* -- Schemas & models (registered once) ------------------------------------ */

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: null },
    // Platform-level super-admin flag (§14) — not tied to any org membership.
    is_super_admin: { type: Boolean, required: true, default: false },
    // Platform-level support-admin tier — limited admin (§ product spec).
    is_support_admin: { type: Boolean, required: true, default: false },
    status: {
      type: String,
      required: true,
      default: USER_STATUSES.active,
      index: true,
    },
    email_verified_at: { type: Date, default: null },
    trial_used_at: { type: Date, default: null },
    deleted_at: { type: Date, default: null },
    marketing_emails_enabled: { type: Boolean, required: true, default: true },
    unsubscribe_token: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
  },
  { timestamps: true, collection: "users" },
);

const organizationSchema = new Schema<OrganizationDoc>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    // Billing linkage (Phase 5). Indexed for the webhook's customer→org lookup.
    stripe_customer_id: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    trial_ends_at: { type: Date, default: null },
  },
  { timestamps: true, collection: "organizations" },
);

// Plans are PLATFORM-level — no organization_id (§15). Monetary fields are
// integer minor units (cents).
const planSchema = new Schema<PlanDoc>(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    price_monthly: { type: Number, required: true },
    price_annual: { type: Number, default: null },
    annual_discount_percent: { type: Number, default: null },
    limits: { type: Schema.Types.Mixed, default: {} },
    is_active: { type: Boolean, required: true, default: true },
    sort_order: { type: Number, required: true, default: 0 },
    stripe_product_id: { type: String, default: null },
    stripe_price_id_monthly: { type: String, default: null },
    stripe_price_id_annual: { type: String, default: null },
  },
  { timestamps: true, collection: "plans" },
);

// Platform-level singleton settings row (unique `key`).
const appSettingsSchema = new Schema<AppSettingsDoc>(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    trial_days: { type: Number, required: true, default: DEFAULT_TRIAL_DAYS },
    lead_scoring_rubric: { type: String, default: null },
  },
  { timestamps: true, collection: "app_settings" },
);

const subscriptionSchema = new Schema<SubscriptionDoc>(
  {
    // Tenant key — indexed on every tenant-scoped collection (§1.3).
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    plan_id: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
    status: {
      type: String,
      required: true,
      default: SUBSCRIPTION_STATUSES.trialing,
    },
    stripe_customer_id: { type: String, default: null },
    stripe_subscription_id: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    current_period_end: { type: Date, default: null },
    cancel_at_period_end: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, collection: "subscriptions" },
);

const organizationMemberSchema = new Schema<OrganizationMemberDoc>(
  {
    // Tenant key — indexed on every tenant-scoped collection (§1.3).
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: { type: String, required: true, default: ORG_ROLES.user },
  },
  { timestamps: true, collection: "organization_members" },
);
organizationMemberSchema.index(
  { organization_id: 1, user_id: 1 },
  { unique: true },
);

const invitationSchema = new Schema<InvitationDoc>(
  {
    // Tenant key — indexed on every tenant-scoped collection (§1.3).
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    email: { type: String, required: true, index: true },
    role: { type: String, required: true, default: ORG_ROLES.user },
    token: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      required: true,
      default: INVITATION_STATUSES.pending,
    },
    invited_by_user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expires_at: { type: Date, required: true },
  },
  { timestamps: true, collection: "organization_invitations" },
);

const profileSchema = new Schema<ProfileDoc>(
  {
    // Tenant key — indexed on every tenant-scoped collection (§1.3).
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    contact: { type: Schema.Types.Mixed, default: {} },
    summary: { type: String, default: null },
    skills: { type: [String], default: [] },
    // Structured sub-documents are stored schema-less (Mixed) — their shape is
    // enforced by the Zod domain schemas at the adapter boundary.
    experience: { type: Schema.Types.Mixed, default: [] },
    education: { type: Schema.Types.Mixed, default: [] },
    projects: { type: Schema.Types.Mixed, default: [] },
    custom_fields: { type: Schema.Types.Mixed, default: [] },
    knowledge_base: { type: String, default: "" },
    links: { type: Schema.Types.Mixed, default: {} },
    work_authorization: { type: String, default: null },
    work_arrangement: { type: String, default: null },
    employment_types: { type: [String], default: [] },
    salary_expectation: { type: String, default: null },
    // Packed ciphertext only — encrypted/decrypted by the profile service.
    eeo: { type: Schema.Types.Mixed, default: null },
    is_default: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, collection: "profiles" },
);
profileSchema.index({ user_id: 1, name: 1 }, { unique: true });

const profileDomainPrefSchema = new Schema<ProfileDomainPrefDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    domain: { type: String, required: true },
    profile_id: { type: Schema.Types.ObjectId, ref: "Profile", required: true },
    last_used_at: { type: Date, required: true },
  },
  { timestamps: true, collection: "profile_domain_prefs" },
);
profileDomainPrefSchema.index({ user_id: 1, domain: 1 }, { unique: true });

const applicationSchema = new Schema<ApplicationDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    profile_id: { type: Schema.Types.ObjectId, ref: "Profile", default: null },
    company: { type: String, required: true },
    role_title: { type: String, required: true },
    url: { type: String, default: null },
    domain: { type: String, default: null },
    platform: { type: String, default: null },
    additional_links: { type: Schema.Types.Mixed, default: [] },
    status: { type: String, required: true, default: "Applied" },
    fit_score: { type: Number, default: null },
    fit_reasoning: { type: String, default: null },
    filter_results: { type: Schema.Types.Mixed, default: [] },
    applied_at: { type: Date, required: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true, collection: "applications" },
);
applicationSchema.index({ user_id: 1, applied_at: -1 });
applicationSchema.index({ user_id: 1, status: 1 });

const jobFilterSchema = new Schema<JobFilterDoc>(
  {
    label: { type: String, required: true },
    // 'admin' = platform default (no owner); 'user' = one user's custom filter.
    type: { type: String, required: true, index: true },
    owner_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
      sparse: true,
    },
    description: { type: String, default: null },
    is_active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, collection: "job_filters" },
);

const userFilterSettingSchema = new Schema<UserFilterSettingDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    filter_id: {
      type: Schema.Types.ObjectId,
      ref: "JobFilter",
      required: true,
    },
    enabled: { type: Boolean, required: true },
  },
  { timestamps: true, collection: "user_filter_settings" },
);
userFilterSettingSchema.index({ user_id: 1, filter_id: 1 }, { unique: true });

// Append-only audit log — no updates, newest-first reads.
const adminActionSchema = new Schema<AdminActionDoc>(
  {
    actor_user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actor_role: { type: String, required: true },
    action: { type: String, required: true, index: true },
    target_user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
      sparse: true,
    },
    target_id: { type: String, default: null },
    reason: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "admin_actions" },
);
adminActionSchema.index({ createdAt: -1 });

const gmailScanSchema = new Schema<GmailScanDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    range_from: { type: Date, required: true },
    range_to: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      default: GMAIL_SCAN_STATUSES.running,
    },
    error: { type: String, default: null },
    proposals: { type: Schema.Types.Mixed, default: [] },
  },
  { timestamps: true, collection: "gmail_scans" },
);

const leadSchemaMongo = new Schema<LeadDoc>(
  {
    // Tenant key — indexed on every tenant-scoped collection (§1.3).
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    // identity
    campaign_ids: { type: [Schema.Types.ObjectId], ref: "Campaign", default: [] },
    source_type: { type: String, required: true },
    source_url: { type: String, default: null },
    captured_at: { type: Date, required: true },
    captured_by_user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    client_capture_id: { type: String, default: null },
    capture_session_id: {
      type: Schema.Types.ObjectId,
      ref: "CaptureSession",
      default: null,
    },
    // captured
    business_name: { type: String, required: true },
    category: { type: String, default: null },
    categories: { type: [String], default: [] },
    phone: { type: String, default: null },
    phone_e164: { type: String, default: null },
    website: { type: String, default: null },
    website_domain: { type: String, default: null },
    // Structured sub-documents are stored schema-less (Mixed) — their shape is
    // enforced by the Zod domain schemas at the adapter boundary.
    address: { type: Schema.Types.Mixed, default: {} },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    rating: { type: Number, default: null },
    review_count: { type: Number, default: null },
    price_level: { type: Number, default: null },
    hours: { type: String, default: null },
    plus_code: { type: String, default: null },
    // enriched
    owner_name: { type: String, default: null },
    emails: { type: [String], default: [] },
    socials: { type: Schema.Types.Mixed, default: {} },
    tech_stack: { type: [String], default: [] },
    page_speed: { type: Schema.Types.Mixed, default: {} },
    business_size: { type: String, required: true, default: "unknown" },
    industry_sub_type: { type: String, default: null },
    website_status: { type: String, required: true, default: "unknown" },
    enrichment_status: { type: String, default: null },
    enriched_at: { type: Date, default: null },
    // generated
    offer_line: { type: String, default: null },
    offer_line_edited_at: { type: Date, default: null },
    offer_line_prompt_id: { type: String, default: null },
    score: { type: Number, default: null },
    score_reasoning: { type: String, default: null },
    // workflow
    status: { type: String, required: true, default: "new" },
    notes: { type: String, default: "" },
    custom_fields: { type: Schema.Types.Mixed, default: {} },
    parse_issues: { type: [String], default: [] },
    raw_snippet: { type: String, default: null },
    dedupe_keys: { type: [String], default: [] },
    merged_into_id: { type: Schema.Types.ObjectId, ref: "Lead", default: null },
    exported_at: { type: Date, default: null },
    // Soft-delete marker — set instead of removing the row.
    deleted_at: { type: Date, default: null },
  },
  { timestamps: true, collection: "leads" },
);
leadSchemaMongo.index({ organization_id: 1, createdAt: -1 });
// Idempotent capture: one lead per (org, client capture id) when present.
leadSchemaMongo.index(
  { organization_id: 1, client_capture_id: 1 },
  { unique: true, sparse: true },
);
leadSchemaMongo.index({ business_name: "text" });
leadSchemaMongo.index({ organization_id: 1, status: 1 });
leadSchemaMongo.index({ organization_id: 1, phone_e164: 1 });
leadSchemaMongo.index({ organization_id: 1, website_domain: 1 });
leadSchemaMongo.index({ organization_id: 1, campaign_ids: 1 });
leadSchemaMongo.index({ organization_id: 1, capture_session_id: 1 });
leadSchemaMongo.index({ organization_id: 1, score: -1 });

const campaignSchemaMongo = new Schema<CampaignDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    description: { type: String, default: null },
    query: { type: String, default: null },
    location: { type: String, default: null },
    source_type: { type: String, default: null },
    status: { type: String, required: true, default: "active" },
    lead_count: { type: Number, required: true, default: 0 },
    created_by_user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, collection: "campaigns" },
);
campaignSchemaMongo.index({ organization_id: 1, createdAt: -1 });

const leadSourceSchemaMongo = new Schema<LeadSourceDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    lead_id: {
      type: Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
    },
    source_type: { type: String, required: true },
    source_url: { type: String, default: null },
    campaign_id: {
      type: Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
    },
    captured_at: { type: Date, required: true },
    raw_payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "lead_sources" },
);
leadSourceSchemaMongo.index({ organization_id: 1, lead_id: 1 });

const savedViewSchemaMongo = new Schema<SavedViewDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    columns: { type: [String], default: [] },
    filters: { type: Schema.Types.Mixed, default: {} },
    sort: { type: Schema.Types.Mixed, default: { key: "createdAt", dir: "desc" } },
    page_size: { type: Number, required: true, default: 25 },
    is_default: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, collection: "saved_views" },
);
savedViewSchemaMongo.index({ user_id: 1, name: 1 }, { unique: true });

const leadCustomFieldSchemaMongo = new Schema<LeadCustomFieldDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, required: true },
    options: { type: [String], default: [] },
    sort_order: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: "lead_custom_fields" },
);
leadCustomFieldSchemaMongo.index(
  { organization_id: 1, key: 1 },
  { unique: true },
);

// Source packs are PLATFORM-level — no organization_id (§15). One pack per
// source id (unique), fetched by the extension filtered on is_active.
const sourcePackSchemaMongo = new Schema<SourcePackDoc>(
  {
    source_id: { type: String, required: true, unique: true, index: true },
    version: { type: Number, required: true, default: 1 },
    automation_tier: { type: String, required: true },
    selectors: { type: Schema.Types.Mixed, default: {} },
    notes: { type: String, default: null },
    is_active: { type: Boolean, required: true, default: true, index: true },
  },
  { timestamps: true, collection: "source_packs" },
);

const captureSessionSchemaMongo = new Schema<CaptureSessionDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    campaign_id: {
      type: Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    source_type: { type: String, required: true },
    source_url: { type: String, default: null },
    mode: { type: String, required: true },
    started_at: { type: Date, required: true },
    ended_at: { type: Date, default: null },
    captured_count: { type: Number, required: true, default: 0 },
    needs_review_count: { type: Number, required: true, default: 0 },
    status: { type: String, required: true, default: "running" },
    extension_version: { type: String, default: null },
    created_by_user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, collection: "capture_sessions" },
);
captureSessionSchemaMongo.index({ organization_id: 1, started_at: -1 });

const batchJobSchemaMongo = new Schema<BatchJobDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    type: { type: String, required: true },
    status: { type: String, required: true, default: "queued" },
    target_filter: { type: Schema.Types.Mixed, default: null },
    lead_ids: { type: [String], default: [] },
    total: { type: Number, required: true, default: 0 },
    processed: { type: Number, required: true, default: 0 },
    succeeded: { type: Number, required: true, default: 0 },
    failed: { type: Number, required: true, default: 0 },
    error: { type: String, default: null },
    params: { type: Schema.Types.Mixed, default: {} },
    created_by_user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    started_at: { type: Date, default: null },
    finished_at: { type: Date, default: null },
  },
  { timestamps: true, collection: "batch_jobs" },
);
batchJobSchemaMongo.index({ organization_id: 1, createdAt: -1 });
batchJobSchemaMongo.index({ organization_id: 1, status: 1 });

const offerPromptSchemaMongo = new Schema<OfferPromptDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    prompt_text: { type: String, required: true },
    is_default: { type: Boolean, required: true, default: false },
    provider: { type: String, default: null },
    model: { type: String, default: null },
    created_by_user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, collection: "offer_prompts" },
);
offerPromptSchemaMongo.index({ organization_id: 1, createdAt: -1 });

const duplicateCandidateSchemaMongo = new Schema<DuplicateCandidateDoc>(
  {
    organization_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    lead_a_id: { type: Schema.Types.ObjectId, ref: "Lead", required: true },
    lead_b_id: { type: Schema.Types.ObjectId, ref: "Lead", required: true },
    matched_on: { type: [String], default: [] },
    confidence: { type: Number, required: true, default: 0 },
    status: { type: String, required: true, default: "pending" },
  },
  { timestamps: true, collection: "duplicate_candidates" },
);
duplicateCandidateSchemaMongo.index({ organization_id: 1, status: 1 });
duplicateCandidateSchemaMongo.index({ organization_id: 1, lead_a_id: 1 });

/** Reuse existing models across hot-reloads / repeated imports. */
function model<T>(name: string, schema: Schema<T>): Model<T> {
  return (
    (mongoose.models[name] as Model<T> | undefined) ??
    mongoose.model<T>(name, schema)
  );
}

const UserModel = model<UserDoc>("User", userSchema);
const OrganizationModel = model<OrganizationDoc>(
  "Organization",
  organizationSchema,
);
const OrganizationMemberModel = model<OrganizationMemberDoc>(
  "OrganizationMember",
  organizationMemberSchema,
);
const InvitationModel = model<InvitationDoc>("Invitation", invitationSchema);
const PlanModel = model<PlanDoc>("Plan", planSchema);
const AppSettingsModel = model<AppSettingsDoc>(
  "AppSettings",
  appSettingsSchema,
);
const SubscriptionModel = model<SubscriptionDoc>(
  "Subscription",
  subscriptionSchema,
);
const ProfileModel = model<ProfileDoc>("Profile", profileSchema);
const ProfileDomainPrefModel = model<ProfileDomainPrefDoc>(
  "ProfileDomainPref",
  profileDomainPrefSchema,
);
const ApplicationModel = model<ApplicationDoc>(
  "Application",
  applicationSchema,
);
const JobFilterModel = model<JobFilterDoc>("JobFilter", jobFilterSchema);
const UserFilterSettingModel = model<UserFilterSettingDoc>(
  "UserFilterSetting",
  userFilterSettingSchema,
);
const AdminActionModel = model<AdminActionDoc>(
  "AdminAction",
  adminActionSchema,
);
const GmailScanModel = model<GmailScanDoc>("GmailScan", gmailScanSchema);
const LeadModel = model<LeadDoc>("Lead", leadSchemaMongo);
const CampaignModel = model<CampaignDoc>("Campaign", campaignSchemaMongo);
const LeadSourceModel = model<LeadSourceDoc>(
  "LeadSource",
  leadSourceSchemaMongo,
);
const SavedViewModel = model<SavedViewDoc>("SavedView", savedViewSchemaMongo);
const LeadCustomFieldModel = model<LeadCustomFieldDoc>(
  "LeadCustomField",
  leadCustomFieldSchemaMongo,
);
const SourcePackModel = model<SourcePackDoc>(
  "SourcePack",
  sourcePackSchemaMongo,
);
const CaptureSessionModel = model<CaptureSessionDoc>(
  "CaptureSession",
  captureSessionSchemaMongo,
);
const BatchJobModel = model<BatchJobDoc>("BatchJob", batchJobSchemaMongo);
const OfferPromptModel = model<OfferPromptDoc>(
  "OfferPrompt",
  offerPromptSchemaMongo,
);
const DuplicateCandidateModel = model<DuplicateCandidateDoc>(
  "DuplicateCandidate",
  duplicateCandidateSchemaMongo,
);

/* -- Mappers --------------------------------------------------------------- */

function toUser(doc: UserDoc): User {
  return {
    id: doc._id.toString(),
    email: doc.email,
    name: doc.name,
    isSuperAdmin: doc.is_super_admin ?? false,
    isSupportAdmin: doc.is_support_admin ?? false,
    status: (doc.status ?? USER_STATUSES.active) as User["status"],
    emailVerifiedAt: doc.email_verified_at ?? null,
    trialUsedAt: doc.trial_used_at ?? null,
    deletedAt: doc.deleted_at ?? null,
    marketingEmailsEnabled: doc.marketing_emails_enabled ?? true,
    unsubscribeToken: doc.unsubscribe_token ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toOrganization(doc: OrganizationDoc): Organization {
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    stripeCustomerId: doc.stripe_customer_id ?? null,
    trialEndsAt: doc.trial_ends_at ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toPlan(doc: PlanDoc): Plan {
  return {
    id: doc._id.toString(),
    slug: doc.slug,
    name: doc.name,
    description: doc.description ?? null,
    priceMonthly: doc.price_monthly,
    priceAnnual: doc.price_annual ?? null,
    annualDiscountPercent: doc.annual_discount_percent ?? null,
    limits: doc.limits ?? {},
    isActive: doc.is_active,
    sortOrder: doc.sort_order,
    stripeProductId: doc.stripe_product_id ?? null,
    stripePriceIdMonthly: doc.stripe_price_id_monthly ?? null,
    stripePriceIdAnnual: doc.stripe_price_id_annual ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toAppSettings(doc: AppSettingsDoc): AppSettings {
  return {
    id: doc._id.toString(),
    trialDays: doc.trial_days,
    leadScoringRubric: doc.lead_scoring_rubric ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toSubscription(doc: SubscriptionDoc): Subscription {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    planId: doc.plan_id.toString(),
    status: doc.status as Subscription["status"],
    stripeCustomerId: doc.stripe_customer_id ?? null,
    stripeSubscriptionId: doc.stripe_subscription_id ?? null,
    currentPeriodEnd: doc.current_period_end ?? null,
    cancelAtPeriodEnd: doc.cancel_at_period_end,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toMember(doc: OrganizationMemberDoc): OrganizationMember {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    userId: doc.user_id.toString(),
    role: doc.role,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toInvitation(doc: InvitationDoc): Invitation {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    email: doc.email,
    role: doc.role,
    token: doc.token,
    status: doc.status as Invitation["status"],
    invitedByUserId: doc.invited_by_user_id.toString(),
    expiresAt: doc.expires_at,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toProfile(doc: ProfileDoc): Profile {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    userId: doc.user_id.toString(),
    name: doc.name,
    contact: doc.contact ?? {},
    summary: doc.summary ?? null,
    skills: doc.skills ?? [],
    experience: doc.experience ?? [],
    education: doc.education ?? [],
    projects: doc.projects ?? [],
    customFields: doc.custom_fields ?? [],
    knowledgeBase: doc.knowledge_base ?? "",
    links: doc.links ?? {},
    workAuthorization: (doc.work_authorization ??
      null) as Profile["workAuthorization"],
    workArrangement: (doc.work_arrangement ??
      null) as Profile["workArrangement"],
    employmentTypes: (doc.employment_types ??
      []) as Profile["employmentTypes"],
    salaryExpectation: doc.salary_expectation ?? null,
    eeo: doc.eeo ?? null,
    isDefault: doc.is_default ?? false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toProfileDomainPref(doc: ProfileDomainPrefDoc): ProfileDomainPref {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    userId: doc.user_id.toString(),
    domain: doc.domain,
    profileId: doc.profile_id.toString(),
    lastUsedAt: doc.last_used_at,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toApplication(doc: ApplicationDoc): Application {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    userId: doc.user_id.toString(),
    profileId: doc.profile_id ? doc.profile_id.toString() : null,
    company: doc.company,
    roleTitle: doc.role_title,
    url: doc.url ?? null,
    domain: doc.domain ?? null,
    platform: doc.platform ?? null,
    additionalLinks: doc.additional_links ?? [],
    status: doc.status as Application["status"],
    fitScore: doc.fit_score ?? null,
    fitReasoning: doc.fit_reasoning ?? null,
    filterResults: doc.filter_results ?? [],
    appliedAt: doc.applied_at,
    notes: doc.notes ?? "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toJobFilter(doc: JobFilterDoc): JobFilter {
  return {
    id: doc._id.toString(),
    label: doc.label,
    type: doc.type as JobFilter["type"],
    ownerId: doc.owner_id ? doc.owner_id.toString() : null,
    description: doc.description ?? null,
    isActive: doc.is_active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toUserFilterSetting(doc: UserFilterSettingDoc): UserFilterSetting {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    userId: doc.user_id.toString(),
    filterId: doc.filter_id.toString(),
    enabled: doc.enabled,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toAdminAction(doc: AdminActionDoc): AdminAction {
  return {
    id: doc._id.toString(),
    actorUserId: doc.actor_user_id.toString(),
    actorRole: doc.actor_role as AdminAction["actorRole"],
    action: doc.action as AdminAction["action"],
    targetUserId: doc.target_user_id ? doc.target_user_id.toString() : null,
    targetId: doc.target_id ?? null,
    reason: doc.reason ?? "",
    metadata: doc.metadata ?? {},
    createdAt: doc.createdAt,
  };
}

function toGmailScan(doc: GmailScanDoc): GmailScan {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    userId: doc.user_id.toString(),
    rangeFrom: doc.range_from,
    rangeTo: doc.range_to,
    status: doc.status as GmailScan["status"],
    error: doc.error ?? null,
    proposals: doc.proposals ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toLead(doc: LeadDoc): Lead {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    campaignIds: (doc.campaign_ids ?? []).map((c) => c.toString()),
    sourceType: doc.source_type as Lead["sourceType"],
    sourceUrl: doc.source_url ?? null,
    capturedAt: doc.captured_at,
    capturedByUserId: doc.captured_by_user_id
      ? doc.captured_by_user_id.toString()
      : null,
    clientCaptureId: doc.client_capture_id ?? null,
    captureSessionId: doc.capture_session_id
      ? doc.capture_session_id.toString()
      : null,
    businessName: doc.business_name,
    category: doc.category ?? null,
    categories: doc.categories ?? [],
    phone: doc.phone ?? null,
    phoneE164: doc.phone_e164 ?? null,
    website: doc.website ?? null,
    websiteDomain: doc.website_domain ?? null,
    address: doc.address ?? {},
    lat: doc.lat ?? null,
    lng: doc.lng ?? null,
    rating: doc.rating ?? null,
    reviewCount: doc.review_count ?? null,
    priceLevel: doc.price_level ?? null,
    hours: doc.hours ?? null,
    plusCode: doc.plus_code ?? null,
    ownerName: doc.owner_name ?? null,
    emails: doc.emails ?? [],
    socials: doc.socials ?? {},
    techStack: doc.tech_stack ?? [],
    pageSpeed: doc.page_speed ?? {},
    businessSize: (doc.business_size ?? "unknown") as Lead["businessSize"],
    industrySubType: doc.industry_sub_type ?? null,
    websiteStatus: (doc.website_status ?? "unknown") as Lead["websiteStatus"],
    enrichmentStatus: doc.enrichment_status ?? null,
    enrichedAt: doc.enriched_at ?? null,
    offerLine: doc.offer_line ?? null,
    offerLineEditedAt: doc.offer_line_edited_at ?? null,
    offerLinePromptId: doc.offer_line_prompt_id ?? null,
    score: doc.score ?? null,
    scoreReasoning: doc.score_reasoning ?? null,
    status: doc.status as Lead["status"],
    notes: doc.notes ?? "",
    customFields: doc.custom_fields ?? {},
    parseIssues: doc.parse_issues ?? [],
    rawSnippet: doc.raw_snippet ?? null,
    dedupeKeys: doc.dedupe_keys ?? [],
    mergedIntoId: doc.merged_into_id ? doc.merged_into_id.toString() : null,
    exportedAt: doc.exported_at ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    deletedAt: doc.deleted_at ?? null,
  };
}

function toCampaign(doc: CampaignDoc): Campaign {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    name: doc.name,
    description: doc.description ?? null,
    query: doc.query ?? null,
    location: doc.location ?? null,
    sourceType: (doc.source_type ?? null) as Campaign["sourceType"],
    status: doc.status as Campaign["status"],
    leadCount: doc.lead_count ?? 0,
    createdByUserId: doc.created_by_user_id.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toLeadSource(doc: LeadSourceDoc): LeadSource {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    leadId: doc.lead_id.toString(),
    sourceType: doc.source_type as LeadSource["sourceType"],
    sourceUrl: doc.source_url ?? null,
    campaignId: doc.campaign_id ? doc.campaign_id.toString() : null,
    capturedAt: doc.captured_at,
    rawPayload: doc.raw_payload ?? {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toSavedView(doc: SavedViewDoc): SavedView {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    userId: doc.user_id.toString(),
    name: doc.name,
    columns: doc.columns ?? [],
    filters: doc.filters ?? {},
    sort: doc.sort ?? { key: "createdAt", dir: "desc" },
    pageSize: (doc.page_size ?? 25) as SavedView["pageSize"],
    isDefault: doc.is_default ?? false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toLeadCustomField(doc: LeadCustomFieldDoc): LeadCustomField {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    key: doc.key,
    label: doc.label,
    type: doc.type as LeadCustomField["type"],
    options: doc.options ?? [],
    sortOrder: doc.sort_order ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toSourcePack(doc: SourcePackDoc): SourcePack {
  return {
    id: doc._id.toString(),
    sourceId: doc.source_id,
    version: doc.version ?? 1,
    automationTier: doc.automation_tier as SourcePack["automationTier"],
    selectors: doc.selectors ?? {},
    notes: doc.notes ?? null,
    isActive: doc.is_active ?? true,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toCaptureSession(doc: CaptureSessionDoc): CaptureSession {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    campaignId: doc.campaign_id.toString(),
    sourceType: doc.source_type as CaptureSession["sourceType"],
    sourceUrl: doc.source_url ?? null,
    mode: doc.mode as CaptureSession["mode"],
    startedAt: doc.started_at,
    endedAt: doc.ended_at ?? null,
    capturedCount: doc.captured_count ?? 0,
    needsReviewCount: doc.needs_review_count ?? 0,
    status: doc.status as CaptureSession["status"],
    extensionVersion: doc.extension_version ?? null,
    createdByUserId: doc.created_by_user_id.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toBatchJob(doc: BatchJobDoc): BatchJob {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    type: doc.type as BatchJob["type"],
    status: doc.status as BatchJob["status"],
    targetFilter: doc.target_filter ?? null,
    leadIds: doc.lead_ids ?? [],
    total: doc.total ?? 0,
    processed: doc.processed ?? 0,
    succeeded: doc.succeeded ?? 0,
    failed: doc.failed ?? 0,
    error: doc.error ?? null,
    params: doc.params ?? {},
    createdByUserId: doc.created_by_user_id.toString(),
    startedAt: doc.started_at ?? null,
    finishedAt: doc.finished_at ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toOfferPrompt(doc: OfferPromptDoc): OfferPrompt {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    name: doc.name,
    promptText: doc.prompt_text,
    isDefault: doc.is_default ?? false,
    provider: doc.provider ?? null,
    model: doc.model ?? null,
    createdByUserId: doc.created_by_user_id.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toDuplicateCandidate(doc: DuplicateCandidateDoc): DuplicateCandidate {
  return {
    id: doc._id.toString(),
    organizationId: doc.organization_id.toString(),
    leadAId: doc.lead_a_id.toString(),
    leadBId: doc.lead_b_id.toString(),
    matchedOn: doc.matched_on ?? [],
    confidence: doc.confidence ?? 0,
    status: doc.status as DuplicateCandidate["status"],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Map a camelCase lead patch (create or update) to the stored snake_case write
 * document, setting only the keys present in `patch`. Reference ids are wrapped
 * in ObjectIds; `organization_id` is set separately by the caller.
 */
function leadWriteDoc(patch: UpdateLead): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (patch.campaignIds !== undefined)
    u.campaign_ids = patch.campaignIds.map(
      (c) => new mongoose.Types.ObjectId(c),
    );
  if (patch.sourceType !== undefined) u.source_type = patch.sourceType;
  if (patch.sourceUrl !== undefined) u.source_url = patch.sourceUrl ?? null;
  if (patch.capturedAt !== undefined) u.captured_at = patch.capturedAt;
  if (patch.capturedByUserId !== undefined)
    u.captured_by_user_id = patch.capturedByUserId
      ? new mongoose.Types.ObjectId(patch.capturedByUserId)
      : null;
  if (patch.clientCaptureId !== undefined)
    u.client_capture_id = patch.clientCaptureId ?? null;
  if (patch.captureSessionId !== undefined)
    u.capture_session_id = patch.captureSessionId
      ? new mongoose.Types.ObjectId(patch.captureSessionId)
      : null;
  if (patch.businessName !== undefined) u.business_name = patch.businessName;
  if (patch.category !== undefined) u.category = patch.category ?? null;
  if (patch.categories !== undefined) u.categories = patch.categories;
  if (patch.phone !== undefined) u.phone = patch.phone ?? null;
  if (patch.phoneE164 !== undefined) u.phone_e164 = patch.phoneE164 ?? null;
  if (patch.website !== undefined) u.website = patch.website ?? null;
  if (patch.websiteDomain !== undefined)
    u.website_domain = patch.websiteDomain ?? null;
  if (patch.address !== undefined) u.address = patch.address;
  if (patch.lat !== undefined) u.lat = patch.lat ?? null;
  if (patch.lng !== undefined) u.lng = patch.lng ?? null;
  if (patch.rating !== undefined) u.rating = patch.rating ?? null;
  if (patch.reviewCount !== undefined)
    u.review_count = patch.reviewCount ?? null;
  if (patch.priceLevel !== undefined) u.price_level = patch.priceLevel ?? null;
  if (patch.hours !== undefined) u.hours = patch.hours ?? null;
  if (patch.plusCode !== undefined) u.plus_code = patch.plusCode ?? null;
  if (patch.ownerName !== undefined) u.owner_name = patch.ownerName ?? null;
  if (patch.emails !== undefined) u.emails = patch.emails;
  if (patch.socials !== undefined) u.socials = patch.socials;
  if (patch.techStack !== undefined) u.tech_stack = patch.techStack;
  if (patch.pageSpeed !== undefined) u.page_speed = patch.pageSpeed;
  if (patch.businessSize !== undefined) u.business_size = patch.businessSize;
  if (patch.industrySubType !== undefined)
    u.industry_sub_type = patch.industrySubType ?? null;
  if (patch.websiteStatus !== undefined)
    u.website_status = patch.websiteStatus;
  if (patch.enrichmentStatus !== undefined)
    u.enrichment_status = patch.enrichmentStatus ?? null;
  if (patch.enrichedAt !== undefined) u.enriched_at = patch.enrichedAt ?? null;
  if (patch.offerLine !== undefined) u.offer_line = patch.offerLine ?? null;
  if (patch.offerLineEditedAt !== undefined)
    u.offer_line_edited_at = patch.offerLineEditedAt ?? null;
  if (patch.offerLinePromptId !== undefined)
    u.offer_line_prompt_id = patch.offerLinePromptId ?? null;
  if (patch.score !== undefined) u.score = patch.score ?? null;
  if (patch.scoreReasoning !== undefined)
    u.score_reasoning = patch.scoreReasoning ?? null;
  if (patch.status !== undefined) u.status = patch.status;
  if (patch.notes !== undefined) u.notes = patch.notes;
  if (patch.customFields !== undefined) u.custom_fields = patch.customFields;
  if (patch.parseIssues !== undefined) u.parse_issues = patch.parseIssues;
  if (patch.rawSnippet !== undefined) u.raw_snippet = patch.rawSnippet ?? null;
  if (patch.dedupeKeys !== undefined) u.dedupe_keys = patch.dedupeKeys;
  if (patch.mergedIntoId !== undefined)
    u.merged_into_id = patch.mergedIntoId
      ? new mongoose.Types.ObjectId(patch.mergedIntoId)
      : null;
  if (patch.exportedAt !== undefined) u.exported_at = patch.exportedAt ?? null;
  if (patch.deletedAt !== undefined) u.deleted_at = patch.deletedAt ?? null;
  return u;
}

/**
 * Build the org-scoped lead query: strips any org key a caller placed on the
 * filter, forces this org, and excludes soft-deleted rows. This is the single
 * choke point that guarantees a lead read/write never crosses tenants.
 */
function leadScope(
  orgId: string,
  filter: Record<string, unknown> = {},
): Record<string, unknown> {
  const scoped: Record<string, unknown> = { ...filter };
  delete scoped.organizationId;
  delete scoped.organization_id;
  scoped.organization_id = new mongoose.Types.ObjectId(orgId);
  scoped.deleted_at = null;
  return scoped;
}

function requireUri(): string {
  if (!env.MONGODB_URI) {
    throw new Error("MongoAdapter: MONGODB_URI is not configured");
  }
  return env.MONGODB_URI;
}

/** Connect once, lazily; reuse the singleton connection thereafter. Exported so
 * the auth adapter (which stores credentials in the same Mongo connection) can
 * share it. */
let connectionPromise: Promise<typeof mongoose> | null = null;
export async function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  connectionPromise ??= mongoose.connect(requireUri());
  await connectionPromise;
}

export class MongoAdapter implements DatabaseAdapter {
  private async connect(): Promise<void> {
    await connectMongo();
  }

  /* -- Users -------------------------------------------------------------- */

  async createUser(input: NewUser): Promise<User> {
    await this.connect();
    const created = await UserModel.create({
      email: input.email,
      name: input.name ?? null,
      unsubscribe_token: input.unsubscribeToken ?? null,
    });
    return toUser(created.toObject<UserDoc>());
  }

  async getUserById(id: string): Promise<User | null> {
    await this.connect();
    const doc = await UserModel.findById(id).lean<UserDoc>().exec();
    return doc ? toUser(doc) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    await this.connect();
    const doc = await UserModel.findOne({ email }).lean<UserDoc>().exec();
    return doc ? toUser(doc) : null;
  }

  async updateUser(id: string, patch: UpdateUser): Promise<User> {
    await this.connect();
    // Map camelCase domain fields to the stored field names.
    const update: Record<string, unknown> = {};
    if (patch.email !== undefined) update.email = patch.email;
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.isSuperAdmin !== undefined)
      update.is_super_admin = patch.isSuperAdmin;
    if (patch.isSupportAdmin !== undefined)
      update.is_support_admin = patch.isSupportAdmin;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.emailVerifiedAt !== undefined)
      update.email_verified_at = patch.emailVerifiedAt ?? null;
    if (patch.trialUsedAt !== undefined)
      update.trial_used_at = patch.trialUsedAt ?? null;
    if (patch.deletedAt !== undefined)
      update.deleted_at = patch.deletedAt ?? null;
    if (patch.marketingEmailsEnabled !== undefined)
      update.marketing_emails_enabled = patch.marketingEmailsEnabled;
    if (patch.unsubscribeToken !== undefined)
      update.unsubscribe_token = patch.unsubscribeToken ?? null;
    const doc = await UserModel.findByIdAndUpdate(id, update, { new: true })
      .lean<UserDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateUser: user ${id} not found`);
    return toUser(doc);
  }

  async getUserByUnsubscribeToken(token: string): Promise<User | null> {
    await this.connect();
    const doc = await UserModel.findOne({ unsubscribe_token: token })
      .lean<UserDoc>()
      .exec();
    return doc ? toUser(doc) : null;
  }

  async listUsers(params: ListUsersParams = {}): Promise<ListUsersResult> {
    await this.connect();
    const { search, limit = 25, offset = 0 } = params;
    const query: Record<string, unknown> = {};
    if (search) {
      const pattern = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      query.$or = [{ email: pattern }, { name: pattern }];
    }
    const [docs, total] = await Promise.all([
      UserModel.find(query)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean<UserDoc[]>()
        .exec(),
      UserModel.countDocuments(query).exec(),
    ]);
    return { users: docs.map(toUser), total };
  }

  async deleteUser(id: string): Promise<void> {
    await this.connect();
    await UserModel.findByIdAndDelete(id).exec();
  }

  /* -- Organizations ------------------------------------------------------ */

  async createOrganization(input: NewOrganization): Promise<Organization> {
    await this.connect();
    const created = await OrganizationModel.create({
      name: input.name,
      slug: input.slug,
      trial_ends_at: input.trialEndsAt ?? null,
    });
    return toOrganization(created.toObject<OrganizationDoc>());
  }

  async getOrganizationById(id: string): Promise<Organization | null> {
    await this.connect();
    const doc = await OrganizationModel.findById(id)
      .lean<OrganizationDoc>()
      .exec();
    return doc ? toOrganization(doc) : null;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    await this.connect();
    const doc = await OrganizationModel.findOne({ slug })
      .lean<OrganizationDoc>()
      .exec();
    return doc ? toOrganization(doc) : null;
  }

  async updateOrganization(
    id: string,
    patch: UpdateOrganization,
  ): Promise<Organization> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.slug !== undefined) update.slug = patch.slug;
    if (patch.stripeCustomerId !== undefined)
      update.stripe_customer_id = patch.stripeCustomerId;
    if (patch.trialEndsAt !== undefined)
      update.trial_ends_at = patch.trialEndsAt ?? null;
    const doc = await OrganizationModel.findByIdAndUpdate(id, update, {
      new: true,
    })
      .lean<OrganizationDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateOrganization: org ${id} not found`);
    return toOrganization(doc);
  }

  async getOrganizationByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<Organization | null> {
    await this.connect();
    const doc = await OrganizationModel.findOne({
      stripe_customer_id: stripeCustomerId,
    })
      .lean<OrganizationDoc>()
      .exec();
    return doc ? toOrganization(doc) : null;
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.connect();
    await OrganizationModel.findByIdAndDelete(id).exec();
  }

  /* -- Membership (scoped by organization_id) ----------------------------- */

  async addMember(input: NewOrganizationMember): Promise<OrganizationMember> {
    await this.connect();
    const parsed = newOrganizationMemberSchema.parse(input);
    const created = await OrganizationMemberModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      user_id: new mongoose.Types.ObjectId(parsed.userId),
      role: parsed.role,
    });
    return toMember(created.toObject<OrganizationMemberDoc>());
  }

  async getMembership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null> {
    await this.connect();
    const doc = await OrganizationMemberModel.findOne({
      organization_id: organizationId,
      user_id: userId,
    })
      .lean<OrganizationMemberDoc>()
      .exec();
    return doc ? toMember(doc) : null;
  }

  async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    await this.connect();
    const docs = await OrganizationMemberModel.find({
      organization_id: organizationId,
    })
      .lean<OrganizationMemberDoc[]>()
      .exec();
    return docs.map(toMember);
  }

  async listMembershipsForUser(userId: string): Promise<OrganizationMember[]> {
    await this.connect();
    const docs = await OrganizationMemberModel.find({ user_id: userId })
      .lean<OrganizationMemberDoc[]>()
      .exec();
    return docs.map(toMember);
  }

  async listMembershipsForUsers(
    userIds: string[],
  ): Promise<OrganizationMember[]> {
    await this.connect();
    if (userIds.length === 0) return [];
    const docs = await OrganizationMemberModel.find({
      user_id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .lean<OrganizationMemberDoc[]>()
      .exec();
    return docs.map(toMember);
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrganizationMember> {
    await this.connect();
    const doc = await OrganizationMemberModel.findOneAndUpdate(
      { organization_id: organizationId, user_id: userId },
      { role },
      { new: true },
    )
      .lean<OrganizationMemberDoc>()
      .exec();
    if (!doc) {
      throw new Error(
        `mongo updateMemberRole: membership (${organizationId}, ${userId}) not found`,
      );
    }
    return toMember(doc);
  }

  async removeMember(organizationId: string, userId: string): Promise<void> {
    await this.connect();
    await OrganizationMemberModel.deleteOne({
      organization_id: organizationId,
      user_id: userId,
    }).exec();
  }

  /* -- Invitations (scoped by organization_id) ---------------------------- */

  async createInvitation(input: NewInvitation): Promise<Invitation> {
    await this.connect();
    const parsed = newInvitationSchema.parse(input);
    const created = await InvitationModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      email: parsed.email,
      role: parsed.role,
      token: parsed.token,
      status: parsed.status,
      invited_by_user_id: new mongoose.Types.ObjectId(parsed.invitedByUserId),
      expires_at: parsed.expiresAt,
    });
    return toInvitation(created.toObject<InvitationDoc>());
  }

  async getInvitationByToken(token: string): Promise<Invitation | null> {
    await this.connect();
    const doc = await InvitationModel.findOne({ token })
      .lean<InvitationDoc>()
      .exec();
    return doc ? toInvitation(doc) : null;
  }

  async listInvitations(organizationId: string): Promise<Invitation[]> {
    await this.connect();
    const docs = await InvitationModel.find({
      organization_id: organizationId,
    })
      .lean<InvitationDoc[]>()
      .exec();
    return docs.map(toInvitation);
  }

  async updateInvitationStatus(
    id: string,
    status: InvitationStatus,
  ): Promise<Invitation> {
    await this.connect();
    const doc = await InvitationModel.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    )
      .lean<InvitationDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateInvitationStatus: ${id} not found`);
    return toInvitation(doc);
  }

  async getPendingInvitationForEmail(
    organizationId: string,
    email: string,
  ): Promise<Invitation | null> {
    await this.connect();
    const doc = await InvitationModel.findOne({
      organization_id: organizationId,
      email,
      status: INVITATION_STATUSES.pending,
    })
      .lean<InvitationDoc>()
      .exec();
    return doc ? toInvitation(doc) : null;
  }

  /* -- Plans (platform-level, no organization_id — §15) ------------------- */

  async createPlan(input: NewPlan): Promise<Plan> {
    await this.connect();
    const parsed = newPlanSchema.parse(input);
    const created = await PlanModel.create({
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description ?? null,
      price_monthly: parsed.priceMonthly,
      price_annual: parsed.priceAnnual ?? null,
      annual_discount_percent: parsed.annualDiscountPercent ?? null,
      limits: parsed.limits,
      is_active: parsed.isActive,
      sort_order: parsed.sortOrder,
      stripe_product_id: parsed.stripeProductId ?? null,
      stripe_price_id_monthly: parsed.stripePriceIdMonthly ?? null,
      stripe_price_id_annual: parsed.stripePriceIdAnnual ?? null,
    });
    return toPlan(created.toObject<PlanDoc>());
  }

  async getPlanById(id: string): Promise<Plan | null> {
    await this.connect();
    const doc = await PlanModel.findById(id).lean<PlanDoc>().exec();
    return doc ? toPlan(doc) : null;
  }

  async getPlanBySlug(slug: string): Promise<Plan | null> {
    await this.connect();
    const doc = await PlanModel.findOne({ slug }).lean<PlanDoc>().exec();
    return doc ? toPlan(doc) : null;
  }

  async listPlans(): Promise<Plan[]> {
    await this.connect();
    const docs = await PlanModel.find()
      .sort({ sort_order: 1 })
      .lean<PlanDoc[]>()
      .exec();
    return docs.map(toPlan);
  }

  async listActivePlans(): Promise<Plan[]> {
    await this.connect();
    const docs = await PlanModel.find({ is_active: true })
      .sort({ sort_order: 1 })
      .lean<PlanDoc[]>()
      .exec();
    return docs.map(toPlan);
  }

  async updatePlan(id: string, patch: UpdatePlan): Promise<Plan> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.slug !== undefined) update.slug = patch.slug;
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.priceMonthly !== undefined)
      update.price_monthly = patch.priceMonthly;
    if (patch.priceAnnual !== undefined)
      update.price_annual = patch.priceAnnual;
    if (patch.annualDiscountPercent !== undefined)
      update.annual_discount_percent = patch.annualDiscountPercent;
    if (patch.limits !== undefined) update.limits = patch.limits;
    if (patch.isActive !== undefined) update.is_active = patch.isActive;
    if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
    if (patch.stripeProductId !== undefined)
      update.stripe_product_id = patch.stripeProductId;
    if (patch.stripePriceIdMonthly !== undefined)
      update.stripe_price_id_monthly = patch.stripePriceIdMonthly;
    if (patch.stripePriceIdAnnual !== undefined)
      update.stripe_price_id_annual = patch.stripePriceIdAnnual;
    const doc = await PlanModel.findByIdAndUpdate(id, update, { new: true })
      .lean<PlanDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updatePlan: plan ${id} not found`);
    return toPlan(doc);
  }

  async deletePlan(id: string): Promise<void> {
    await this.connect();
    await PlanModel.findByIdAndDelete(id).exec();
  }

  /* -- App settings (platform-level singleton) ---------------------------- */

  async getAppSettings(): Promise<AppSettings> {
    await this.connect();
    const existing = await AppSettingsModel.findOne({ key: "global" })
      .lean<AppSettingsDoc>()
      .exec();
    if (existing) return toAppSettings(existing);
    const created = await AppSettingsModel.create({
      key: "global",
      trial_days: DEFAULT_TRIAL_DAYS,
    });
    return toAppSettings(created.toObject<AppSettingsDoc>());
  }

  async updateAppSettings(patch: UpdateAppSettings): Promise<AppSettings> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.trialDays !== undefined) update.trial_days = patch.trialDays;
    if (patch.leadScoringRubric !== undefined)
      update.lead_scoring_rubric = patch.leadScoringRubric ?? null;
    const doc = await AppSettingsModel.findOneAndUpdate(
      { key: "global" },
      { $set: update, $setOnInsert: { key: "global" } },
      { new: true, upsert: true },
    )
      .lean<AppSettingsDoc>()
      .exec();
    return toAppSettings(doc as AppSettingsDoc);
  }

  /* -- Subscriptions (scoped by organization_id) -------------------------- */

  async createSubscription(input: NewSubscription): Promise<Subscription> {
    await this.connect();
    const parsed = newSubscriptionSchema.parse(input);
    const created = await SubscriptionModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      plan_id: new mongoose.Types.ObjectId(parsed.planId),
      status: parsed.status,
      stripe_customer_id: parsed.stripeCustomerId ?? null,
      stripe_subscription_id: parsed.stripeSubscriptionId ?? null,
      current_period_end: parsed.currentPeriodEnd ?? null,
      cancel_at_period_end: parsed.cancelAtPeriodEnd,
    });
    return toSubscription(created.toObject<SubscriptionDoc>());
  }

  async getSubscriptionByOrg(
    organizationId: string,
  ): Promise<Subscription | null> {
    await this.connect();
    const doc = await SubscriptionModel.findOne({
      organization_id: organizationId,
    })
      .sort({ createdAt: -1 })
      .lean<SubscriptionDoc>()
      .exec();
    return doc ? toSubscription(doc) : null;
  }

  async getSubscriptionByStripeId(
    stripeSubscriptionId: string,
  ): Promise<Subscription | null> {
    await this.connect();
    const doc = await SubscriptionModel.findOne({
      stripe_subscription_id: stripeSubscriptionId,
    })
      .lean<SubscriptionDoc>()
      .exec();
    return doc ? toSubscription(doc) : null;
  }

  async listSubscriptions(): Promise<Subscription[]> {
    await this.connect();
    const docs = await SubscriptionModel.find()
      .sort({ createdAt: -1 })
      .lean<SubscriptionDoc[]>()
      .exec();
    return docs.map(toSubscription);
  }

  async updateSubscription(
    id: string,
    patch: UpdateSubscription,
  ): Promise<Subscription> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.planId !== undefined)
      update.plan_id = new mongoose.Types.ObjectId(patch.planId);
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.stripeCustomerId !== undefined)
      update.stripe_customer_id = patch.stripeCustomerId;
    if (patch.stripeSubscriptionId !== undefined)
      update.stripe_subscription_id = patch.stripeSubscriptionId;
    if (patch.currentPeriodEnd !== undefined)
      update.current_period_end = patch.currentPeriodEnd ?? null;
    if (patch.cancelAtPeriodEnd !== undefined)
      update.cancel_at_period_end = patch.cancelAtPeriodEnd;
    const doc = await SubscriptionModel.findByIdAndUpdate(id, update, {
      new: true,
    })
      .lean<SubscriptionDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateSubscription: ${id} not found`);
    return toSubscription(doc);
  }

  async listSubscriptionsForOrgs(
    organizationIds: string[],
  ): Promise<Subscription[]> {
    await this.connect();
    if (organizationIds.length === 0) return [];
    const docs = await SubscriptionModel.find({
      organization_id: {
        $in: organizationIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    })
      .lean<SubscriptionDoc[]>()
      .exec();
    return docs.map(toSubscription);
  }

  /* -- Profiles (scoped by organization_id; multiple per user) ------------- */

  async createProfile(input: NewProfile): Promise<Profile> {
    await this.connect();
    const parsed = newProfileSchema.parse(input);
    const created = await ProfileModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      user_id: new mongoose.Types.ObjectId(parsed.userId),
      name: parsed.name,
      contact: parsed.contact,
      summary: parsed.summary ?? null,
      skills: parsed.skills,
      experience: parsed.experience,
      education: parsed.education,
      projects: parsed.projects,
      custom_fields: parsed.customFields,
      knowledge_base: parsed.knowledgeBase,
      links: parsed.links,
      work_authorization: parsed.workAuthorization ?? null,
      work_arrangement: parsed.workArrangement ?? null,
      employment_types: parsed.employmentTypes,
      salary_expectation: parsed.salaryExpectation ?? null,
      eeo: parsed.eeo ?? null,
      is_default: parsed.isDefault,
    });
    return toProfile(created.toObject<ProfileDoc>());
  }

  async getProfileById(id: string): Promise<Profile | null> {
    await this.connect();
    const doc = await ProfileModel.findById(id).lean<ProfileDoc>().exec();
    return doc ? toProfile(doc) : null;
  }

  async listProfilesForUser(userId: string): Promise<Profile[]> {
    await this.connect();
    const docs = await ProfileModel.find({ user_id: userId })
      .sort({ createdAt: 1 })
      .lean<ProfileDoc[]>()
      .exec();
    return docs.map(toProfile);
  }

  async updateProfile(id: string, patch: UpdateProfile): Promise<Profile> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.contact !== undefined) update.contact = patch.contact;
    if (patch.summary !== undefined) update.summary = patch.summary ?? null;
    if (patch.skills !== undefined) update.skills = patch.skills;
    if (patch.experience !== undefined) update.experience = patch.experience;
    if (patch.education !== undefined) update.education = patch.education;
    if (patch.projects !== undefined) update.projects = patch.projects;
    if (patch.customFields !== undefined)
      update.custom_fields = patch.customFields;
    if (patch.knowledgeBase !== undefined)
      update.knowledge_base = patch.knowledgeBase;
    if (patch.links !== undefined) update.links = patch.links;
    if (patch.workAuthorization !== undefined)
      update.work_authorization = patch.workAuthorization ?? null;
    if (patch.workArrangement !== undefined)
      update.work_arrangement = patch.workArrangement ?? null;
    if (patch.employmentTypes !== undefined)
      update.employment_types = patch.employmentTypes;
    if (patch.salaryExpectation !== undefined)
      update.salary_expectation = patch.salaryExpectation ?? null;
    if (patch.eeo !== undefined) update.eeo = patch.eeo ?? null;
    if (patch.isDefault !== undefined) update.is_default = patch.isDefault;
    const doc = await ProfileModel.findByIdAndUpdate(id, update, { new: true })
      .lean<ProfileDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateProfile: profile ${id} not found`);
    return toProfile(doc);
  }

  async deleteProfile(id: string): Promise<void> {
    await this.connect();
    await ProfileModel.findByIdAndDelete(id).exec();
    await ProfileDomainPrefModel.deleteMany({ profile_id: id }).exec();
  }

  /* -- Profile domain prefs ------------------------------------------------ */

  async setProfileDomainPref(
    organizationId: string,
    userId: string,
    domain: string,
    profileId: string,
  ): Promise<ProfileDomainPref> {
    await this.connect();
    const doc = await ProfileDomainPrefModel.findOneAndUpdate(
      {
        user_id: new mongoose.Types.ObjectId(userId),
        domain,
      },
      {
        $set: {
          profile_id: new mongoose.Types.ObjectId(profileId),
          last_used_at: new Date(),
        },
        $setOnInsert: {
          organization_id: new mongoose.Types.ObjectId(organizationId),
        },
      },
      { new: true, upsert: true },
    )
      .lean<ProfileDomainPrefDoc>()
      .exec();
    return toProfileDomainPref(doc as ProfileDomainPrefDoc);
  }

  async getProfileDomainPref(
    userId: string,
    domain: string,
  ): Promise<ProfileDomainPref | null> {
    await this.connect();
    const doc = await ProfileDomainPrefModel.findOne({
      user_id: userId,
      domain,
    })
      .lean<ProfileDomainPrefDoc>()
      .exec();
    return doc ? toProfileDomainPref(doc) : null;
  }

  /* -- Applications (scoped by organization_id) ---------------------------- */

  async createApplication(input: NewApplication): Promise<Application> {
    await this.connect();
    const parsed = newApplicationSchema.parse(input);
    const created = await ApplicationModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      user_id: new mongoose.Types.ObjectId(parsed.userId),
      profile_id: parsed.profileId
        ? new mongoose.Types.ObjectId(parsed.profileId)
        : null,
      company: parsed.company,
      role_title: parsed.roleTitle,
      url: parsed.url ?? null,
      domain: parsed.domain ?? null,
      platform: parsed.platform ?? null,
      additional_links: parsed.additionalLinks,
      status: parsed.status,
      fit_score: parsed.fitScore ?? null,
      fit_reasoning: parsed.fitReasoning ?? null,
      filter_results: parsed.filterResults,
      applied_at: parsed.appliedAt,
      notes: parsed.notes,
    });
    return toApplication(created.toObject<ApplicationDoc>());
  }

  async getApplicationById(id: string): Promise<Application | null> {
    await this.connect();
    const doc = await ApplicationModel.findById(id)
      .lean<ApplicationDoc>()
      .exec();
    return doc ? toApplication(doc) : null;
  }

  async listApplicationsForUser(userId: string): Promise<Application[]> {
    await this.connect();
    const docs = await ApplicationModel.find({ user_id: userId })
      .sort({ applied_at: -1 })
      .lean<ApplicationDoc[]>()
      .exec();
    return docs.map(toApplication);
  }

  async updateApplication(
    id: string,
    patch: UpdateApplication,
  ): Promise<Application> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.profileId !== undefined)
      update.profile_id = patch.profileId
        ? new mongoose.Types.ObjectId(patch.profileId)
        : null;
    if (patch.company !== undefined) update.company = patch.company;
    if (patch.roleTitle !== undefined) update.role_title = patch.roleTitle;
    if (patch.url !== undefined) update.url = patch.url ?? null;
    if (patch.domain !== undefined) update.domain = patch.domain ?? null;
    if (patch.platform !== undefined) update.platform = patch.platform ?? null;
    if (patch.additionalLinks !== undefined)
      update.additional_links = patch.additionalLinks;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.fitScore !== undefined) update.fit_score = patch.fitScore ?? null;
    if (patch.fitReasoning !== undefined)
      update.fit_reasoning = patch.fitReasoning ?? null;
    if (patch.filterResults !== undefined)
      update.filter_results = patch.filterResults;
    if (patch.appliedAt !== undefined) update.applied_at = patch.appliedAt;
    if (patch.notes !== undefined) update.notes = patch.notes;
    const doc = await ApplicationModel.findByIdAndUpdate(id, update, {
      new: true,
    })
      .lean<ApplicationDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateApplication: ${id} not found`);
    return toApplication(doc);
  }

  async deleteApplication(id: string): Promise<void> {
    await this.connect();
    await ApplicationModel.findByIdAndDelete(id).exec();
  }

  async deleteApplicationsForUser(
    userId: string,
    ids: string[],
  ): Promise<number> {
    await this.connect();
    if (ids.length === 0) return 0;
    const result = await ApplicationModel.deleteMany({
      user_id: new mongoose.Types.ObjectId(userId),
      _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
    }).exec();
    return result.deletedCount ?? 0;
  }

  async updateApplicationsStatusForUser(
    userId: string,
    ids: string[],
    status: ApplicationStatus,
  ): Promise<number> {
    await this.connect();
    if (ids.length === 0) return 0;
    const result = await ApplicationModel.updateMany(
      {
        user_id: new mongoose.Types.ObjectId(userId),
        _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
      },
      { status },
    ).exec();
    return result.modifiedCount ?? 0;
  }

  /* -- Job filters ---------------------------------------------------------- */

  async createJobFilter(input: NewJobFilter): Promise<JobFilter> {
    await this.connect();
    const parsed = newJobFilterSchema.parse(input);
    const created = await JobFilterModel.create({
      label: parsed.label,
      type: parsed.type,
      owner_id: parsed.ownerId
        ? new mongoose.Types.ObjectId(parsed.ownerId)
        : null,
      description: parsed.description ?? null,
      is_active: parsed.isActive,
    });
    return toJobFilter(created.toObject<JobFilterDoc>());
  }

  async getJobFilterById(id: string): Promise<JobFilter | null> {
    await this.connect();
    const doc = await JobFilterModel.findById(id).lean<JobFilterDoc>().exec();
    return doc ? toJobFilter(doc) : null;
  }

  async listAdminJobFilters(): Promise<JobFilter[]> {
    await this.connect();
    const docs = await JobFilterModel.find({ type: "admin" })
      .sort({ createdAt: 1 })
      .lean<JobFilterDoc[]>()
      .exec();
    return docs.map(toJobFilter);
  }

  async listJobFiltersForUser(userId: string): Promise<JobFilter[]> {
    await this.connect();
    const docs = await JobFilterModel.find({
      $or: [
        { type: "admin", is_active: true },
        { type: "user", owner_id: new mongoose.Types.ObjectId(userId) },
      ],
    })
      .sort({ createdAt: 1 })
      .lean<JobFilterDoc[]>()
      .exec();
    return docs.map(toJobFilter);
  }

  async updateJobFilter(
    id: string,
    patch: UpdateJobFilter,
  ): Promise<JobFilter> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.label !== undefined) update.label = patch.label;
    if (patch.description !== undefined)
      update.description = patch.description ?? null;
    if (patch.isActive !== undefined) update.is_active = patch.isActive;
    const doc = await JobFilterModel.findByIdAndUpdate(id, update, {
      new: true,
    })
      .lean<JobFilterDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateJobFilter: ${id} not found`);
    return toJobFilter(doc);
  }

  async deleteJobFilter(id: string): Promise<void> {
    await this.connect();
    await JobFilterModel.findByIdAndDelete(id).exec();
    await UserFilterSettingModel.deleteMany({ filter_id: id }).exec();
  }

  /* -- User filter settings ------------------------------------------------- */

  async setUserFilterEnabled(
    organizationId: string,
    userId: string,
    filterId: string,
    enabled: boolean,
  ): Promise<UserFilterSetting> {
    await this.connect();
    const doc = await UserFilterSettingModel.findOneAndUpdate(
      {
        user_id: new mongoose.Types.ObjectId(userId),
        filter_id: new mongoose.Types.ObjectId(filterId),
      },
      {
        $set: { enabled },
        $setOnInsert: {
          organization_id: new mongoose.Types.ObjectId(organizationId),
        },
      },
      { new: true, upsert: true },
    )
      .lean<UserFilterSettingDoc>()
      .exec();
    return toUserFilterSetting(doc as UserFilterSettingDoc);
  }

  async listUserFilterSettings(userId: string): Promise<UserFilterSetting[]> {
    await this.connect();
    const docs = await UserFilterSettingModel.find({ user_id: userId })
      .lean<UserFilterSettingDoc[]>()
      .exec();
    return docs.map(toUserFilterSetting);
  }

  /* -- Admin actions (append-only audit log) -------------------------------- */

  async createAdminAction(input: NewAdminAction): Promise<AdminAction> {
    await this.connect();
    const parsed = newAdminActionSchema.parse(input);
    const created = await AdminActionModel.create({
      actor_user_id: new mongoose.Types.ObjectId(parsed.actorUserId),
      actor_role: parsed.actorRole,
      action: parsed.action,
      target_user_id: parsed.targetUserId
        ? new mongoose.Types.ObjectId(parsed.targetUserId)
        : null,
      target_id: parsed.targetId ?? null,
      reason: parsed.reason,
      metadata: parsed.metadata,
    });
    return toAdminAction(created.toObject<AdminActionDoc>());
  }

  async listAdminActions(
    params: ListAdminActionsParams = {},
  ): Promise<ListAdminActionsResult> {
    await this.connect();
    const { limit = 50, offset = 0 } = params;
    const [docs, total] = await Promise.all([
      AdminActionModel.find()
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean<AdminActionDoc[]>()
        .exec(),
      AdminActionModel.countDocuments().exec(),
    ]);
    return { actions: docs.map(toAdminAction), total };
  }

  /* -- Gmail scans ----------------------------------------------------------- */

  async createGmailScan(input: NewGmailScan): Promise<GmailScan> {
    await this.connect();
    const parsed = newGmailScanSchema.parse(input);
    const created = await GmailScanModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      user_id: new mongoose.Types.ObjectId(parsed.userId),
      range_from: parsed.rangeFrom,
      range_to: parsed.rangeTo,
      status: parsed.status,
      error: parsed.error ?? null,
      proposals: parsed.proposals,
    });
    return toGmailScan(created.toObject<GmailScanDoc>());
  }

  async getGmailScanById(id: string): Promise<GmailScan | null> {
    await this.connect();
    const doc = await GmailScanModel.findById(id).lean<GmailScanDoc>().exec();
    return doc ? toGmailScan(doc) : null;
  }

  async listGmailScansForUser(userId: string): Promise<GmailScan[]> {
    await this.connect();
    const docs = await GmailScanModel.find({ user_id: userId })
      .sort({ createdAt: -1 })
      .lean<GmailScanDoc[]>()
      .exec();
    return docs.map(toGmailScan);
  }

  async updateGmailScan(
    id: string,
    patch: UpdateGmailScan,
  ): Promise<GmailScan> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.error !== undefined) update.error = patch.error ?? null;
    if (patch.proposals !== undefined) update.proposals = patch.proposals;
    const doc = await GmailScanModel.findByIdAndUpdate(id, update, {
      new: true,
    })
      .lean<GmailScanDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateGmailScan: ${id} not found`);
    return toGmailScan(doc);
  }

  /* -- Leads (scoped by organization_id) ----------------------------------- */

  async listLeads(
    orgId: string,
    params: ListLeadsParams = {},
  ): Promise<ListLeadsResult> {
    await this.connect();
    const { filter = {}, sort, skip = 0, limit = 25 } = params;
    const query = leadScope(orgId, filter);
    const sortSpec = sort ?? { createdAt: -1 };
    const [docs, total] = await Promise.all([
      LeadModel.find(query)
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .lean<LeadDoc[]>()
        .exec(),
      LeadModel.countDocuments(query).exec(),
    ]);
    return { leads: docs.map(toLead), total };
  }

  async countLeads(
    orgId: string,
    filter: Record<string, unknown> = {},
  ): Promise<number> {
    await this.connect();
    return LeadModel.countDocuments(leadScope(orgId, filter)).exec();
  }

  async getLeadById(orgId: string, id: string): Promise<Lead | null> {
    await this.connect();
    const doc = await LeadModel.findOne({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
      deleted_at: null,
    })
      .lean<LeadDoc>()
      .exec();
    return doc ? toLead(doc) : null;
  }

  async createLead(input: NewLead): Promise<Lead> {
    await this.connect();
    const parsed = newLeadSchema.parse(input);
    const created = await LeadModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      ...leadWriteDoc(parsed),
    });
    return toLead(created.toObject<LeadDoc>());
  }

  async updateLead(
    orgId: string,
    id: string,
    patch: UpdateLead,
  ): Promise<Lead> {
    await this.connect();
    const doc = await LeadModel.findOneAndUpdate(
      {
        _id: id,
        organization_id: new mongoose.Types.ObjectId(orgId),
        deleted_at: null,
      },
      leadWriteDoc(patch),
      { new: true },
    )
      .lean<LeadDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateLead: lead ${id} not found`);
    return toLead(doc);
  }

  async deleteLead(orgId: string, id: string): Promise<void> {
    await this.connect();
    // Soft delete — set the marker, keep the row.
    await LeadModel.findOneAndUpdate(
      { _id: id, organization_id: new mongoose.Types.ObjectId(orgId) },
      { deleted_at: new Date() },
    ).exec();
  }

  async bulkUpdateLeads(
    orgId: string,
    ids: string[],
    patch: UpdateLead,
  ): Promise<number> {
    await this.connect();
    if (ids.length === 0) return 0;
    const result = await LeadModel.updateMany(
      {
        organization_id: new mongoose.Types.ObjectId(orgId),
        _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
        deleted_at: null,
      },
      leadWriteDoc(patch),
    ).exec();
    return result.modifiedCount ?? 0;
  }

  async bulkDeleteLeads(orgId: string, ids: string[]): Promise<number> {
    await this.connect();
    if (ids.length === 0) return 0;
    const result = await LeadModel.updateMany(
      {
        organization_id: new mongoose.Types.ObjectId(orgId),
        _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
        deleted_at: null,
      },
      { deleted_at: new Date() },
    ).exec();
    return result.modifiedCount ?? 0;
  }

  async upsertLeadByClientCaptureId(
    orgId: string,
    clientCaptureId: string,
    data: NewLead,
  ): Promise<{ lead: Lead; created: boolean }> {
    await this.connect();
    const parsed = newLeadSchema.parse(data);
    const write = leadWriteDoc(parsed);
    // The capture key + org are controlled here, not by the write payload, so
    // they never collide between $set and $setOnInsert.
    delete write.client_capture_id;
    // The capture session is set on create only; a re-synced record must not
    // have its original session overwritten by a later run (set-if-missing is
    // handled below for pre-session rows).
    const captureSessionId = write.capture_session_id as
      | mongoose.Types.ObjectId
      | null
      | undefined;
    delete write.capture_session_id;
    const orgObjectId = new mongoose.Types.ObjectId(orgId);
    const existing = await LeadModel.findOne({
      organization_id: orgObjectId,
      client_capture_id: clientCaptureId,
    })
      .select("_id")
      .lean<{ _id: mongoose.Types.ObjectId }>()
      .exec();
    const doc = await LeadModel.findOneAndUpdate(
      { organization_id: orgObjectId, client_capture_id: clientCaptureId },
      {
        $set: write,
        $setOnInsert: {
          organization_id: orgObjectId,
          client_capture_id: clientCaptureId,
          ...(captureSessionId
            ? { capture_session_id: captureSessionId }
            : {}),
        },
      },
      { new: true, upsert: true },
    )
      .lean<LeadDoc>()
      .exec();
    // Backfill the session on an existing row that never had one.
    if (existing && captureSessionId && !doc.capture_session_id) {
      await LeadModel.updateOne(
        { _id: doc._id, capture_session_id: null },
        { $set: { capture_session_id: captureSessionId } },
      ).exec();
      doc.capture_session_id = captureSessionId;
    }
    return { lead: toLead(doc as LeadDoc), created: !existing };
  }

  async *streamLeads(
    orgId: string,
    filter: Record<string, unknown> = {},
    sort?: Record<string, 1 | -1>,
  ): AsyncGenerator<Lead> {
    await this.connect();
    const query = leadScope(orgId, filter);
    const sortSpec = sort ?? { createdAt: -1 };
    const cursor = LeadModel.find(query)
      .sort(sortSpec)
      .lean<LeadDoc>()
      .cursor();
    for await (const doc of cursor) {
      yield toLead(doc as LeadDoc);
    }
  }

  async listLeadsByIds(orgId: string, ids: string[]): Promise<Lead[]> {
    await this.connect();
    if (ids.length === 0) return [];
    const docs = await LeadModel.find({
      organization_id: new mongoose.Types.ObjectId(orgId),
      _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
      deleted_at: null,
    })
      .lean<LeadDoc[]>()
      .exec();
    return docs.map(toLead);
  }

  /* -- Lead sources (raw provenance) --------------------------------------- */

  async createLeadSource(input: NewLeadSource): Promise<LeadSource> {
    await this.connect();
    const parsed = newLeadSourceSchema.parse(input);
    const created = await LeadSourceModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      lead_id: new mongoose.Types.ObjectId(parsed.leadId),
      source_type: parsed.sourceType,
      source_url: parsed.sourceUrl ?? null,
      campaign_id: parsed.campaignId
        ? new mongoose.Types.ObjectId(parsed.campaignId)
        : null,
      captured_at: parsed.capturedAt,
      raw_payload: parsed.rawPayload,
    });
    return toLeadSource(created.toObject<LeadSourceDoc>());
  }

  async listLeadSourcesForLead(
    orgId: string,
    leadId: string,
  ): Promise<LeadSource[]> {
    await this.connect();
    const docs = await LeadSourceModel.find({
      organization_id: new mongoose.Types.ObjectId(orgId),
      lead_id: new mongoose.Types.ObjectId(leadId),
    })
      .sort({ createdAt: 1 })
      .lean<LeadSourceDoc[]>()
      .exec();
    return docs.map(toLeadSource);
  }

  async repointLeadSources(
    orgId: string,
    fromLeadId: string,
    toLeadId: string,
  ): Promise<number> {
    await this.connect();
    const result = await LeadSourceModel.updateMany(
      {
        organization_id: new mongoose.Types.ObjectId(orgId),
        lead_id: new mongoose.Types.ObjectId(fromLeadId),
      },
      { lead_id: new mongoose.Types.ObjectId(toLeadId) },
    ).exec();
    return result.modifiedCount ?? 0;
  }

  /* -- Campaigns (scoped by organization_id) ------------------------------- */

  async createCampaign(input: NewCampaign): Promise<Campaign> {
    await this.connect();
    const parsed = newCampaignSchema.parse(input);
    const created = await CampaignModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      name: parsed.name,
      description: parsed.description ?? null,
      query: parsed.query ?? null,
      location: parsed.location ?? null,
      source_type: parsed.sourceType ?? null,
      status: parsed.status,
      lead_count: parsed.leadCount,
      created_by_user_id: new mongoose.Types.ObjectId(parsed.createdByUserId),
    });
    return toCampaign(created.toObject<CampaignDoc>());
  }

  async getCampaignById(orgId: string, id: string): Promise<Campaign | null> {
    await this.connect();
    const doc = await CampaignModel.findOne({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .lean<CampaignDoc>()
      .exec();
    return doc ? toCampaign(doc) : null;
  }

  async listCampaigns(orgId: string): Promise<Campaign[]> {
    await this.connect();
    const docs = await CampaignModel.find({
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .sort({ createdAt: -1 })
      .lean<CampaignDoc[]>()
      .exec();
    return docs.map(toCampaign);
  }

  async updateCampaign(
    orgId: string,
    id: string,
    patch: UpdateCampaign,
  ): Promise<Campaign> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.description !== undefined)
      update.description = patch.description ?? null;
    if (patch.query !== undefined) update.query = patch.query ?? null;
    if (patch.location !== undefined) update.location = patch.location ?? null;
    if (patch.sourceType !== undefined)
      update.source_type = patch.sourceType ?? null;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.leadCount !== undefined) update.lead_count = patch.leadCount;
    const doc = await CampaignModel.findOneAndUpdate(
      { _id: id, organization_id: new mongoose.Types.ObjectId(orgId) },
      update,
      { new: true },
    )
      .lean<CampaignDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateCampaign: campaign ${id} not found`);
    return toCampaign(doc);
  }

  async deleteCampaign(orgId: string, id: string): Promise<void> {
    await this.connect();
    await CampaignModel.findOneAndDelete({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
    }).exec();
  }

  async incrementCampaignLeadCount(
    orgId: string,
    campaignId: string,
    by = 1,
  ): Promise<void> {
    await this.connect();
    await CampaignModel.updateOne(
      { _id: campaignId, organization_id: new mongoose.Types.ObjectId(orgId) },
      { $inc: { lead_count: by } },
    ).exec();
  }

  /* -- Saved views (scoped by organization_id; per user) ------------------- */

  async createSavedView(input: NewSavedView): Promise<SavedView> {
    await this.connect();
    const parsed = newSavedViewSchema.parse(input);
    const created = await SavedViewModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      user_id: new mongoose.Types.ObjectId(parsed.userId),
      name: parsed.name,
      columns: parsed.columns,
      filters: parsed.filters,
      sort: parsed.sort,
      page_size: parsed.pageSize,
      is_default: parsed.isDefault,
    });
    return toSavedView(created.toObject<SavedViewDoc>());
  }

  async listSavedViews(orgId: string, userId: string): Promise<SavedView[]> {
    await this.connect();
    const docs = await SavedViewModel.find({
      organization_id: new mongoose.Types.ObjectId(orgId),
      user_id: new mongoose.Types.ObjectId(userId),
    })
      .sort({ createdAt: 1 })
      .lean<SavedViewDoc[]>()
      .exec();
    return docs.map(toSavedView);
  }

  async updateSavedView(
    orgId: string,
    id: string,
    patch: UpdateSavedView,
  ): Promise<SavedView> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.columns !== undefined) update.columns = patch.columns;
    if (patch.filters !== undefined) update.filters = patch.filters;
    if (patch.sort !== undefined) update.sort = patch.sort;
    if (patch.pageSize !== undefined) update.page_size = patch.pageSize;
    if (patch.isDefault !== undefined) update.is_default = patch.isDefault;
    const doc = await SavedViewModel.findOneAndUpdate(
      { _id: id, organization_id: new mongoose.Types.ObjectId(orgId) },
      update,
      { new: true },
    )
      .lean<SavedViewDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateSavedView: view ${id} not found`);
    return toSavedView(doc);
  }

  async deleteSavedView(orgId: string, id: string): Promise<void> {
    await this.connect();
    await SavedViewModel.findOneAndDelete({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
    }).exec();
  }

  /* -- Lead custom fields (scoped by organization_id) ---------------------- */

  async createLeadCustomField(
    input: NewLeadCustomField,
  ): Promise<LeadCustomField> {
    await this.connect();
    const parsed = newLeadCustomFieldSchema.parse(input);
    const created = await LeadCustomFieldModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      key: parsed.key,
      label: parsed.label,
      type: parsed.type,
      options: parsed.options,
      sort_order: parsed.sortOrder,
    });
    return toLeadCustomField(created.toObject<LeadCustomFieldDoc>());
  }

  async listLeadCustomFields(orgId: string): Promise<LeadCustomField[]> {
    await this.connect();
    const docs = await LeadCustomFieldModel.find({
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .sort({ sort_order: 1 })
      .lean<LeadCustomFieldDoc[]>()
      .exec();
    return docs.map(toLeadCustomField);
  }

  async updateLeadCustomField(
    orgId: string,
    id: string,
    patch: UpdateLeadCustomField,
  ): Promise<LeadCustomField> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.key !== undefined) update.key = patch.key;
    if (patch.label !== undefined) update.label = patch.label;
    if (patch.type !== undefined) update.type = patch.type;
    if (patch.options !== undefined) update.options = patch.options;
    if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
    const doc = await LeadCustomFieldModel.findOneAndUpdate(
      { _id: id, organization_id: new mongoose.Types.ObjectId(orgId) },
      update,
      { new: true },
    )
      .lean<LeadCustomFieldDoc>()
      .exec();
    if (!doc) {
      throw new Error(`mongo updateLeadCustomField: field ${id} not found`);
    }
    return toLeadCustomField(doc);
  }

  async deleteLeadCustomField(orgId: string, id: string): Promise<void> {
    await this.connect();
    await LeadCustomFieldModel.findOneAndDelete({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
    }).exec();
  }

  /* -- Source packs (platform-level, no organization_id — §15) ------------- */

  async listActiveSourcePacks(): Promise<SourcePack[]> {
    await this.connect();
    const docs = await SourcePackModel.find({ is_active: true })
      .sort({ source_id: 1 })
      .lean<SourcePackDoc[]>()
      .exec();
    return docs.map(toSourcePack);
  }

  async listSourcePacks(): Promise<SourcePack[]> {
    await this.connect();
    const docs = await SourcePackModel.find()
      .sort({ source_id: 1 })
      .lean<SourcePackDoc[]>()
      .exec();
    return docs.map(toSourcePack);
  }

  async getSourcePackById(id: string): Promise<SourcePack | null> {
    await this.connect();
    const doc = await SourcePackModel.findById(id)
      .lean<SourcePackDoc>()
      .exec();
    return doc ? toSourcePack(doc) : null;
  }

  async getSourcePackBySourceId(sourceId: string): Promise<SourcePack | null> {
    await this.connect();
    const doc = await SourcePackModel.findOne({ source_id: sourceId })
      .lean<SourcePackDoc>()
      .exec();
    return doc ? toSourcePack(doc) : null;
  }

  async createSourcePack(input: NewSourcePack): Promise<SourcePack> {
    await this.connect();
    const parsed = newSourcePackSchema.parse(input);
    const created = await SourcePackModel.create({
      source_id: parsed.sourceId,
      version: parsed.version,
      automation_tier: parsed.automationTier,
      selectors: parsed.selectors,
      notes: parsed.notes ?? null,
      is_active: parsed.isActive,
    });
    return toSourcePack(created.toObject<SourcePackDoc>());
  }

  async updateSourcePack(
    id: string,
    patch: UpdateSourcePack,
  ): Promise<SourcePack> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.version !== undefined) update.version = patch.version;
    if (patch.automationTier !== undefined)
      update.automation_tier = patch.automationTier;
    if (patch.selectors !== undefined) update.selectors = patch.selectors;
    if (patch.notes !== undefined) update.notes = patch.notes ?? null;
    if (patch.isActive !== undefined) update.is_active = patch.isActive;
    const doc = await SourcePackModel.findByIdAndUpdate(id, update, {
      new: true,
    })
      .lean<SourcePackDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateSourcePack: pack ${id} not found`);
    return toSourcePack(doc);
  }

  async deleteSourcePack(id: string): Promise<void> {
    await this.connect();
    await SourcePackModel.findByIdAndDelete(id).exec();
  }

  /* -- Capture sessions (scoped by organization_id) ------------------------ */

  async createCaptureSession(
    input: NewCaptureSession,
  ): Promise<CaptureSession> {
    await this.connect();
    const parsed = newCaptureSessionSchema.parse(input);
    const created = await CaptureSessionModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      campaign_id: new mongoose.Types.ObjectId(parsed.campaignId),
      source_type: parsed.sourceType,
      source_url: parsed.sourceUrl ?? null,
      mode: parsed.mode,
      started_at: parsed.startedAt,
      ended_at: parsed.endedAt ?? null,
      captured_count: parsed.capturedCount,
      needs_review_count: parsed.needsReviewCount,
      status: parsed.status,
      extension_version: parsed.extensionVersion ?? null,
      created_by_user_id: new mongoose.Types.ObjectId(parsed.createdByUserId),
    });
    return toCaptureSession(created.toObject<CaptureSessionDoc>());
  }

  async getCaptureSession(
    orgId: string,
    id: string,
  ): Promise<CaptureSession | null> {
    await this.connect();
    const doc = await CaptureSessionModel.findOne({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .lean<CaptureSessionDoc>()
      .exec();
    return doc ? toCaptureSession(doc) : null;
  }

  async listCaptureSessions(orgId: string): Promise<CaptureSession[]> {
    await this.connect();
    const docs = await CaptureSessionModel.find({
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .sort({ started_at: -1 })
      .lean<CaptureSessionDoc[]>()
      .exec();
    return docs.map(toCaptureSession);
  }

  async updateCaptureSession(
    orgId: string,
    id: string,
    patch: UpdateCaptureSession,
  ): Promise<CaptureSession> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.campaignId !== undefined)
      update.campaign_id = new mongoose.Types.ObjectId(patch.campaignId);
    if (patch.sourceType !== undefined) update.source_type = patch.sourceType;
    if (patch.sourceUrl !== undefined) update.source_url = patch.sourceUrl ?? null;
    if (patch.mode !== undefined) update.mode = patch.mode;
    if (patch.startedAt !== undefined) update.started_at = patch.startedAt;
    if (patch.endedAt !== undefined) update.ended_at = patch.endedAt ?? null;
    if (patch.capturedCount !== undefined)
      update.captured_count = patch.capturedCount;
    if (patch.needsReviewCount !== undefined)
      update.needs_review_count = patch.needsReviewCount;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.extensionVersion !== undefined)
      update.extension_version = patch.extensionVersion ?? null;
    const doc = await CaptureSessionModel.findOneAndUpdate(
      { _id: id, organization_id: new mongoose.Types.ObjectId(orgId) },
      update,
      { new: true },
    )
      .lean<CaptureSessionDoc>()
      .exec();
    if (!doc) {
      throw new Error(`mongo updateCaptureSession: session ${id} not found`);
    }
    return toCaptureSession(doc);
  }

  /* -- Batch jobs (scoped by organization_id) ------------------------------ */

  async createBatchJob(input: NewBatchJob): Promise<BatchJob> {
    await this.connect();
    const parsed = newBatchJobSchema.parse(input);
    const created = await BatchJobModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      type: parsed.type,
      status: parsed.status,
      target_filter: parsed.targetFilter ?? null,
      lead_ids: parsed.leadIds,
      total: parsed.total,
      processed: parsed.processed,
      succeeded: parsed.succeeded,
      failed: parsed.failed,
      error: parsed.error ?? null,
      params: parsed.params,
      created_by_user_id: new mongoose.Types.ObjectId(parsed.createdByUserId),
      started_at: parsed.startedAt ?? null,
      finished_at: parsed.finishedAt ?? null,
    });
    return toBatchJob(created.toObject<BatchJobDoc>());
  }

  async getBatchJob(orgId: string, id: string): Promise<BatchJob | null> {
    await this.connect();
    const doc = await BatchJobModel.findOne({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .lean<BatchJobDoc>()
      .exec();
    return doc ? toBatchJob(doc) : null;
  }

  async listBatchJobs(orgId: string, limit = 50): Promise<BatchJob[]> {
    await this.connect();
    const docs = await BatchJobModel.find({
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<BatchJobDoc[]>()
      .exec();
    return docs.map(toBatchJob);
  }

  async updateBatchJob(
    orgId: string,
    id: string,
    patch: UpdateBatchJob,
  ): Promise<BatchJob> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.targetFilter !== undefined)
      update.target_filter = patch.targetFilter ?? null;
    if (patch.leadIds !== undefined) update.lead_ids = patch.leadIds;
    if (patch.total !== undefined) update.total = patch.total;
    if (patch.processed !== undefined) update.processed = patch.processed;
    if (patch.succeeded !== undefined) update.succeeded = patch.succeeded;
    if (patch.failed !== undefined) update.failed = patch.failed;
    if (patch.error !== undefined) update.error = patch.error ?? null;
    if (patch.params !== undefined) update.params = patch.params;
    if (patch.startedAt !== undefined)
      update.started_at = patch.startedAt ?? null;
    if (patch.finishedAt !== undefined)
      update.finished_at = patch.finishedAt ?? null;
    const doc = await BatchJobModel.findOneAndUpdate(
      { _id: id, organization_id: new mongoose.Types.ObjectId(orgId) },
      update,
      { new: true },
    )
      .lean<BatchJobDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateBatchJob: job ${id} not found`);
    return toBatchJob(doc);
  }

  /* -- Offer prompts (scoped by organization_id) --------------------------- */

  async createOfferPrompt(input: NewOfferPrompt): Promise<OfferPrompt> {
    await this.connect();
    const parsed = newOfferPromptSchema.parse(input);
    const created = await OfferPromptModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      name: parsed.name,
      prompt_text: parsed.promptText,
      is_default: parsed.isDefault,
      provider: parsed.provider ?? null,
      model: parsed.model ?? null,
      created_by_user_id: new mongoose.Types.ObjectId(parsed.createdByUserId),
    });
    return toOfferPrompt(created.toObject<OfferPromptDoc>());
  }

  async getOfferPrompt(orgId: string, id: string): Promise<OfferPrompt | null> {
    await this.connect();
    const doc = await OfferPromptModel.findOne({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .lean<OfferPromptDoc>()
      .exec();
    return doc ? toOfferPrompt(doc) : null;
  }

  async listOfferPrompts(orgId: string): Promise<OfferPrompt[]> {
    await this.connect();
    const docs = await OfferPromptModel.find({
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .sort({ createdAt: -1 })
      .lean<OfferPromptDoc[]>()
      .exec();
    return docs.map(toOfferPrompt);
  }

  async updateOfferPrompt(
    orgId: string,
    id: string,
    patch: UpdateOfferPrompt,
  ): Promise<OfferPrompt> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.promptText !== undefined) update.prompt_text = patch.promptText;
    if (patch.isDefault !== undefined) update.is_default = patch.isDefault;
    if (patch.provider !== undefined) update.provider = patch.provider ?? null;
    if (patch.model !== undefined) update.model = patch.model ?? null;
    const doc = await OfferPromptModel.findOneAndUpdate(
      { _id: id, organization_id: new mongoose.Types.ObjectId(orgId) },
      update,
      { new: true },
    )
      .lean<OfferPromptDoc>()
      .exec();
    if (!doc) throw new Error(`mongo updateOfferPrompt: prompt ${id} not found`);
    return toOfferPrompt(doc);
  }

  async deleteOfferPrompt(orgId: string, id: string): Promise<void> {
    await this.connect();
    await OfferPromptModel.findOneAndDelete({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
    }).exec();
  }

  async clearDefaultOfferPrompts(
    orgId: string,
    exceptId?: string,
  ): Promise<void> {
    await this.connect();
    const filter: Record<string, unknown> = {
      organization_id: new mongoose.Types.ObjectId(orgId),
      is_default: true,
    };
    if (exceptId) filter._id = { $ne: new mongoose.Types.ObjectId(exceptId) };
    await OfferPromptModel.updateMany(filter, { is_default: false }).exec();
  }

  /* -- Duplicate candidates (scoped by organization_id) -------------------- */

  async createDuplicateCandidate(
    input: NewDuplicateCandidate,
  ): Promise<DuplicateCandidate> {
    await this.connect();
    const parsed = newDuplicateCandidateSchema.parse(input);
    const created = await DuplicateCandidateModel.create({
      organization_id: new mongoose.Types.ObjectId(parsed.organizationId),
      lead_a_id: new mongoose.Types.ObjectId(parsed.leadAId),
      lead_b_id: new mongoose.Types.ObjectId(parsed.leadBId),
      matched_on: parsed.matchedOn,
      confidence: parsed.confidence,
      status: parsed.status,
    });
    return toDuplicateCandidate(created.toObject<DuplicateCandidateDoc>());
  }

  async getDuplicateCandidate(
    orgId: string,
    id: string,
  ): Promise<DuplicateCandidate | null> {
    await this.connect();
    const doc = await DuplicateCandidateModel.findOne({
      _id: id,
      organization_id: new mongoose.Types.ObjectId(orgId),
    })
      .lean<DuplicateCandidateDoc>()
      .exec();
    return doc ? toDuplicateCandidate(doc) : null;
  }

  async listDuplicateCandidates(
    orgId: string,
    status?: string,
  ): Promise<DuplicateCandidate[]> {
    await this.connect();
    const filter: Record<string, unknown> = {
      organization_id: new mongoose.Types.ObjectId(orgId),
    };
    if (status) filter.status = status;
    const docs = await DuplicateCandidateModel.find(filter)
      .sort({ createdAt: -1 })
      .lean<DuplicateCandidateDoc[]>()
      .exec();
    return docs.map(toDuplicateCandidate);
  }

  async getDuplicateCandidateForPair(
    orgId: string,
    leadAId: string,
    leadBId: string,
  ): Promise<DuplicateCandidate | null> {
    await this.connect();
    const a = new mongoose.Types.ObjectId(leadAId);
    const b = new mongoose.Types.ObjectId(leadBId);
    const doc = await DuplicateCandidateModel.findOne({
      organization_id: new mongoose.Types.ObjectId(orgId),
      $or: [
        { lead_a_id: a, lead_b_id: b },
        { lead_a_id: b, lead_b_id: a },
      ],
    })
      .lean<DuplicateCandidateDoc>()
      .exec();
    return doc ? toDuplicateCandidate(doc) : null;
  }

  async updateDuplicateCandidate(
    orgId: string,
    id: string,
    patch: UpdateDuplicateCandidate,
  ): Promise<DuplicateCandidate> {
    await this.connect();
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.confidence !== undefined) update.confidence = patch.confidence;
    if (patch.matchedOn !== undefined) update.matched_on = patch.matchedOn;
    const doc = await DuplicateCandidateModel.findOneAndUpdate(
      { _id: id, organization_id: new mongoose.Types.ObjectId(orgId) },
      update,
      { new: true },
    )
      .lean<DuplicateCandidateDoc>()
      .exec();
    if (!doc) {
      throw new Error(`mongo updateDuplicateCandidate: ${id} not found`);
    }
    return toDuplicateCandidate(doc);
  }

  async disconnect(): Promise<void> {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      connectionPromise = null;
    }
  }
}
