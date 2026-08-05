/**
 * scripts/seed.ts — CORE (CLAUDE.md §2). Provider-aware baseline seed.
 *
 * Seeds whichever provider `DB_PROVIDER` selects. Creates two users WITH valid
 * auth credentials (via the auth adapter, so email/password sign-in works
 * locally), one test organization, and their memberships (admin + user).
 *
 * Per the "new table = three things" rule (§1.4), every model added in a later
 * phase adds its seed entry here in the same commit as its schema and adapter
 * method.
 *
 * Run with `pnpm seed` (or `npm run seed`). Idempotent — safe to re-run against
 * an existing database (users, org, memberships, and pending invites are
 * looked up before insert). Requires valid DB + AUTH env (see .env.example).
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import "./load-env";
import { env } from "@/config/env.schema";
import { auth } from "@/lib/auth";
import {
  db,
  INVITATION_STATUSES,
  JOB_FILTER_TYPES,
  ORG_ROLES,
  PLAN_SLUGS,
  type BusinessSize,
  type Campaign,
  type Invitation,
  type LeadSocials,
  type LeadSourceType,
  type LeadStatus,
  type NewCampaign,
  type NewInvitation,
  type NewLead,
  type NewLeadCustomField,
  type NewOfferPrompt,
  type NewOrganization,
  type NewOrganizationMember,
  type NewPlan,
  type NewSavedView,
  type NewSourcePack,
  type Organization,
  type WebsiteStatus,
} from "@/lib/db";
import { DEFAULT_VISIBLE_COLUMNS } from "@/lib/leads/columns";
import { DEFAULT_SCORING_RUBRIC } from "@/lib/leads/score";

/** Shared password for the seeded users — local testing only. */
const SEED_PASSWORD = "Password123!";

/** How long seeded invitations stay valid. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function ensureUser(
  email: string,
  name: string,
): Promise<{ id: string; email: string }> {
  const existing = await db.getUserByEmail(email);
  if (existing) return existing;
  const { user } = await auth.createCredentials({
    email,
    password: SEED_PASSWORD,
    name,
  });
  return user;
}

async function ensureOrganization(
  input: NewOrganization,
): Promise<Organization> {
  const existing = await db.getOrganizationBySlug(input.slug);
  if (existing) return existing;
  return db.createOrganization(input);
}

async function ensureMember(
  input: NewOrganizationMember,
): Promise<Awaited<ReturnType<typeof db.addMember>>> {
  const existing = await db.getMembership(input.organizationId, input.userId);
  if (existing) return existing;
  return db.addMember(input);
}

async function ensurePendingInvitation(
  input: NewInvitation,
): Promise<Invitation> {
  const existing = await db.getPendingInvitationForEmail(
    input.organizationId,
    input.email,
  );
  if (existing) return existing;
  return db.createInvitation(input);
}

/* -------------------------------------------------------------------------- */
/* ScrapperNinja demo Lead Directory (idempotent)                             */
/* -------------------------------------------------------------------------- */

/**
 * Prefix on every demo lead's `clientCaptureId` — the idempotency key. Re-runs
 * upsert on `(organization_id, client_capture_id)`, and the count of leads with
 * this prefix is the skip check, so `npm run seed` never double-inserts them.
 */
const DEMO_CAPTURE_PREFIX = "seed-demo-";

/** Which demo campaign(s) a lead belongs to. */
type DemoCampaign = "a" | "b" | "both";

/**
 * One demo lead's interesting fields; everything else falls to the schema
 * defaults. `n` drives the `clientCaptureId` (`seed-demo-001`…). The set is
 * hand-tuned to span the workflow: missing websites, needs-review parse issues
 * with a raw snippet, enriched rows, junk, and ready rows with an offer line —
 * across google_maps / manual / csv sources and varied cities/categories.
 */
interface DemoLeadSpec {
  n: number;
  campaign: DemoCampaign;
  businessName: string;
  category: string;
  city: string;
  state: string;
  sourceType: LeadSourceType;
  status: LeadStatus;
  phone?: string;
  website?: string | null;
  websiteStatus?: WebsiteStatus;
  ownerName?: string;
  emails?: string[];
  techStack?: string[];
  socials?: LeadSocials;
  offerLine?: string;
  rating?: number;
  reviewCount?: number;
  businessSize?: BusinessSize;
  parseIssues?: string[];
  rawSnippet?: string;
  enrichmentStatus?: string;
  notes?: string;
  score?: number;
  scoreReasoning?: string;
}

const DEMO_LEADS: readonly DemoLeadSpec[] = [
  // --- Campaign A: Austin home services (mostly google_maps) -------------
  {
    n: 1,
    campaign: "a",
    businessName: "Lone Star Plumbing Co.",
    category: "Plumber",
    city: "Austin",
    state: "TX",
    sourceType: "google_maps",
    status: "ready",
    phone: "(512) 555-0110",
    website: "https://lonestarplumbing.example",
    websiteStatus: "has",
    ownerName: "Marcus Reed",
    emails: ["marcus@lonestarplumbing.example"],
    techStack: ["WordPress", "Google Analytics"],
    socials: { facebook: "https://facebook.com/lonestarplumbing" },
    rating: 4.7,
    reviewCount: 212,
    businessSize: "small",
    enrichmentStatus: "done",
    score: 82,
    scoreReasoning: "Strong reviews, has a website, owner email found.",
    offerLine:
      "Noticed Lone Star Plumbing has 200+ 5-star reviews but no online booking — we could add one this week.",
  },
  {
    n: 2,
    campaign: "a",
    businessName: "Hill Country HVAC",
    category: "HVAC contractor",
    city: "Austin",
    state: "TX",
    sourceType: "google_maps",
    status: "ready",
    phone: "(512) 555-0182",
    website: "https://hillcountryhvac.example",
    websiteStatus: "has",
    ownerName: "Dana Whitfield",
    emails: ["hello@hillcountryhvac.example"],
    techStack: ["Wix"],
    rating: 4.4,
    reviewCount: 96,
    businessSize: "small",
    enrichmentStatus: "done",
    offerLine:
      "Your Wix site loads slowly on mobile — a quick rebuild could lift your Maps ranking.",
  },
  {
    n: 3,
    campaign: "a",
    businessName: "Barton Springs Electric",
    category: "Electrician",
    city: "Austin",
    state: "TX",
    sourceType: "google_maps",
    status: "new",
    phone: "(512) 555-0143",
    website: "https://bartonspringselectric.example",
    websiteStatus: "has",
    rating: 4.9,
    reviewCount: 341,
    businessSize: "medium",
  },
  {
    n: 4,
    campaign: "a",
    businessName: "Congress Ave Roofing",
    category: "Roofing contractor",
    city: "Austin",
    state: "TX",
    sourceType: "google_maps",
    status: "new",
    phone: "(512) 555-0177",
    website: null,
    websiteStatus: "none",
    rating: 4.1,
    reviewCount: 58,
    businessSize: "small",
    notes: "No website — good candidate for a starter site pitch.",
  },
  {
    n: 5,
    campaign: "a",
    businessName: "Zilker Landscaping",
    category: "Landscaper",
    city: "Austin",
    state: "TX",
    sourceType: "google_maps",
    status: "needs_review",
    phone: "(512) 555-0210 ext",
    parseIssues: ["phone", "address"],
    rawSnippet:
      "Zilker Landscaping · Landscaper · Austin, TX · (512) 555-0210 ext ... 4.5 ★",
  },
  {
    n: 6,
    campaign: "a",
    businessName: "Mueller Handyman Services",
    category: "Handyman",
    city: "Austin",
    state: "TX",
    sourceType: "google_maps",
    status: "new",
    phone: "(512) 555-0219",
    website: "http://muellerhandyman.example",
    websiteStatus: "bad",
    rating: 3.9,
    reviewCount: 27,
    businessSize: "solo",
    notes: "Website has no HTTPS — flag for the 'bad website' pitch.",
  },
  {
    n: 7,
    campaign: "a",
    businessName: "South Lamar Pool Care",
    category: "Pool cleaning service",
    city: "Austin",
    state: "TX",
    sourceType: "google_maps",
    status: "junk",
    notes: "Permanently closed per Maps — junk.",
  },
  {
    n: 8,
    campaign: "a",
    businessName: "Travis Heights Painters",
    category: "Painter",
    city: "Austin",
    state: "TX",
    sourceType: "google_maps",
    status: "new",
    phone: "(512) 555-0288",
    website: "https://travisheightspainters.example",
    websiteStatus: "has",
    ownerName: "Priya Nair",
    emails: ["priya@travisheightspainters.example", "info@travisheightspainters.example"],
    techStack: ["Squarespace"],
    rating: 4.6,
    reviewCount: 134,
    businessSize: "small",
    enrichmentStatus: "done",
  },
  {
    n: 9,
    campaign: "a",
    businessName: "Round Rock Garage Doors",
    category: "Garage door supplier",
    city: "Round Rock",
    state: "TX",
    sourceType: "google_maps",
    status: "new",
    phone: "(512) 555-0301",
    website: "https://rrgaragedoors.example",
    websiteStatus: "has",
    rating: 4.3,
    reviewCount: 71,
    businessSize: "small",
  },
  {
    n: 10,
    campaign: "a",
    businessName: "Cedar Park Fence & Deck",
    category: "Fence contractor",
    city: "Cedar Park",
    state: "TX",
    sourceType: "manual",
    status: "new",
    phone: "(512) 555-0333",
    website: null,
    websiteStatus: "none",
    businessSize: "small",
    notes: "Added manually from a referral; no web presence yet.",
  },
  {
    n: 11,
    campaign: "a",
    businessName: "Pflugerville Pest Pros",
    category: "Pest control service",
    city: "Pflugerville",
    state: "TX",
    sourceType: "google_maps",
    status: "needs_review",
    phone: "(512)5550349",
    parseIssues: ["phone"],
    rawSnippet: "Pflugerville Pest Pros — Pest control — (512)5550349 — 4.2",
  },
  {
    n: 12,
    campaign: "a",
    businessName: "Lakeway Window Cleaning",
    category: "Window cleaning service",
    city: "Lakeway",
    state: "TX",
    sourceType: "google_maps",
    status: "ready",
    phone: "(512) 555-0360",
    website: "https://lakewaywindows.example",
    websiteStatus: "has",
    ownerName: "Tom Becker",
    emails: ["tom@lakewaywindows.example"],
    techStack: ["Shopify"],
    rating: 4.8,
    reviewCount: 158,
    businessSize: "small",
    enrichmentStatus: "done",
    score: 76,
    scoreReasoning: "High rating and reachable owner; Shopify site is dated.",
    offerLine:
      "Your Shopify storefront could double as a booking funnel — happy to show a mockup.",
  },
  {
    n: 13,
    campaign: "a",
    businessName: "Bee Cave Locksmith",
    category: "Locksmith",
    city: "Bee Cave",
    state: "TX",
    sourceType: "google_maps",
    status: "archived",
    phone: "(512) 555-0371",
    website: "https://beecavelock.example",
    websiteStatus: "has",
    businessSize: "solo",
    notes: "Already a client — archived from the outreach list.",
  },
  {
    n: 14,
    campaign: "a",
    businessName: "Manor Movers LLC",
    category: "Moving company",
    city: "Manor",
    state: "TX",
    sourceType: "google_maps",
    status: "junk",
    phone: "(512) 555-0388",
    notes: "Duplicate of a national franchise listing — junk.",
  },
  {
    n: 15,
    campaign: "a",
    businessName: "Del Valle Auto Repair",
    category: "Auto repair shop",
    city: "Del Valle",
    state: "TX",
    sourceType: "google_maps",
    status: "new",
    phone: "(512) 555-0392",
    website: "https://delvalleauto.example",
    websiteStatus: "has",
    rating: 4.0,
    reviewCount: 44,
    businessSize: "small",
  },

  // --- Campaign B: Dallas dental & dining (manual + csv + web) -----------
  {
    n: 16,
    campaign: "b",
    businessName: "Uptown Smiles Dental",
    category: "Dentist",
    city: "Dallas",
    state: "TX",
    sourceType: "csv",
    status: "ready",
    phone: "(214) 555-0402",
    website: "https://uptownsmiles.example",
    websiteStatus: "has",
    ownerName: "Dr. Alicia Gomez",
    emails: ["frontdesk@uptownsmiles.example"],
    techStack: ["WordPress", "Meta Pixel"],
    socials: { instagram: "https://instagram.com/uptownsmiles" },
    rating: 4.9,
    reviewCount: 402,
    businessSize: "medium",
    enrichmentStatus: "done",
    score: 88,
    scoreReasoning: "Top reviews, active Instagram, running Meta Pixel already.",
    offerLine:
      "With a Meta Pixel already firing, we can turn Uptown Smiles' Instagram traffic into booked cleanings.",
  },
  {
    n: 17,
    campaign: "b",
    businessName: "Deep Ellum Tacos",
    category: "Mexican restaurant",
    city: "Dallas",
    state: "TX",
    sourceType: "csv",
    status: "new",
    phone: "(214) 555-0418",
    website: "https://deepellumtacos.example",
    websiteStatus: "has",
    rating: 4.5,
    reviewCount: 289,
    businessSize: "small",
  },
  {
    n: 18,
    campaign: "b",
    businessName: "Bishop Arts Bakery",
    category: "Bakery",
    city: "Dallas",
    state: "TX",
    sourceType: "csv",
    status: "new",
    phone: "(214) 555-0423",
    website: null,
    websiteStatus: "none",
    rating: 4.7,
    reviewCount: 176,
    businessSize: "small",
    notes: "Instagram-only; no website at all.",
    socials: { instagram: "https://instagram.com/bishopartsbakery" },
  },
  {
    n: 19,
    campaign: "b",
    businessName: "Knox-Henderson Family Dentistry",
    category: "Dentist",
    city: "Dallas",
    state: "TX",
    sourceType: "manual",
    status: "needs_review",
    parseIssues: ["businessName", "phone"],
    rawSnippet:
      "Knox‑Henderson Family Dentistry ☎ 214.555.0431 · 5 star · Dallas 75204",
  },
  {
    n: 20,
    campaign: "b",
    businessName: "Oak Cliff Coffee House",
    category: "Coffee shop",
    city: "Dallas",
    state: "TX",
    sourceType: "generic_web",
    status: "ready",
    phone: "(214) 555-0447",
    website: "https://oakcliffcoffee.example",
    websiteStatus: "has",
    ownerName: "Renee Adams",
    emails: ["renee@oakcliffcoffee.example"],
    techStack: ["Next.js", "Cloudflare"],
    rating: 4.6,
    reviewCount: 233,
    businessSize: "small",
    enrichmentStatus: "done",
    offerLine:
      "Your Next.js site is fast — let's add a loyalty signup to capture the morning rush.",
  },
  {
    n: 21,
    campaign: "b",
    businessName: "Lakewood Orthodontics",
    category: "Orthodontist",
    city: "Dallas",
    state: "TX",
    sourceType: "csv",
    status: "new",
    phone: "(214) 555-0456",
    website: "https://lakewoodortho.example",
    websiteStatus: "has",
    rating: 4.8,
    reviewCount: 311,
    businessSize: "medium",
  },
  {
    n: 22,
    campaign: "b",
    businessName: "Trinity Groves Grill",
    category: "American restaurant",
    city: "Dallas",
    state: "TX",
    sourceType: "generic_web",
    status: "new",
    phone: "(214) 555-0468",
    website: "http://trinitygrovesgrill.example",
    websiteStatus: "bad",
    rating: 4.2,
    reviewCount: 118,
    businessSize: "small",
    notes: "HTTP-only site, no viewport meta — 'bad website' candidate.",
  },
  {
    n: 23,
    campaign: "b",
    businessName: "Preston Hollow Pediatric Dental",
    category: "Pediatric dentist",
    city: "Dallas",
    state: "TX",
    sourceType: "csv",
    status: "ready",
    phone: "(214) 555-0471",
    website: "https://phpediatricdental.example",
    websiteStatus: "has",
    ownerName: "Dr. Kevin Liu",
    emails: ["hello@phpediatricdental.example"],
    techStack: ["WordPress"],
    rating: 4.9,
    reviewCount: 267,
    businessSize: "medium",
    enrichmentStatus: "done",
    offerLine:
      "Parents book on their phones — a one-tap appointment request would fit Preston Hollow perfectly.",
  },
  {
    n: 24,
    campaign: "b",
    businessName: "Greenville Ave Sushi",
    category: "Sushi restaurant",
    city: "Dallas",
    state: "TX",
    sourceType: "generic_web",
    status: "junk",
    notes: "Closed and delisted — junk.",
  },
  {
    n: 25,
    campaign: "b",
    businessName: "Casa Linda Cafe",
    category: "Cafe",
    city: "Dallas",
    state: "TX",
    sourceType: "manual",
    status: "new",
    phone: "(214) 555-0489",
    website: null,
    websiteStatus: "none",
    businessSize: "solo",
  },

  // --- Shared across both campaigns --------------------------------------
  {
    n: 26,
    campaign: "both",
    businessName: "Metroplex Dental Group",
    category: "Dental clinic",
    city: "Arlington",
    state: "TX",
    sourceType: "csv",
    status: "new",
    phone: "(817) 555-0502",
    website: "https://metroplexdental.example",
    websiteStatus: "has",
    ownerName: "Dr. Sofia Marin",
    emails: ["office@metroplexdental.example"],
    techStack: ["WordPress", "jQuery"],
    rating: 4.5,
    reviewCount: 189,
    businessSize: "large",
    enrichmentStatus: "done",
    notes: "Multi-location; belongs to both the home-services and dining lists.",
  },
  {
    n: 27,
    campaign: "both",
    businessName: "Fort Worth Fine Dining Co.",
    category: "Fine dining restaurant",
    city: "Fort Worth",
    state: "TX",
    sourceType: "generic_web",
    status: "needs_review",
    website: "https://fwfinedining.example",
    parseIssues: ["category", "phone"],
    rawSnippet:
      "Fort Worth Fine Dining Co. | $$$$ | ? | fwfinedining.example | call for reservations",
  },
  {
    n: 28,
    campaign: "both",
    businessName: "North Texas Cleaning Crew",
    category: "Commercial cleaning service",
    city: "Plano",
    state: "TX",
    sourceType: "manual",
    status: "new",
    phone: "(972) 555-0517",
    website: null,
    websiteStatus: "none",
    businessSize: "medium",
  },
  {
    n: 29,
    campaign: "both",
    businessName: "Irving Injury Law Firm",
    category: "Personal injury attorney",
    city: "Irving",
    state: "TX",
    sourceType: "generic_web",
    status: "ready",
    phone: "(972) 555-0524",
    website: "https://irvinginjurylaw.example",
    websiteStatus: "has",
    ownerName: "Robert Hayes",
    emails: ["intake@irvinginjurylaw.example"],
    techStack: ["WordPress", "Google Tag Manager"],
    rating: 4.6,
    reviewCount: 88,
    businessSize: "medium",
    enrichmentStatus: "done",
    score: 79,
    scoreReasoning: "Runs GTM; strong intent to advertise, reachable intake email.",
    offerLine:
      "You're already running Google Tag Manager — let's tighten the intake form so fewer leads bounce.",
  },
  {
    n: 30,
    campaign: "both",
    businessName: "Grapevine Grooming Salon",
    category: "Pet groomer",
    city: "Grapevine",
    state: "TX",
    sourceType: "csv",
    status: "junk",
    notes: "Wrong category on the source directory — junk.",
  },
];

/** Build a full `NewLead` for one demo spec. */
function buildDemoLead(
  orgId: string,
  capturedByUserId: string,
  campaignIds: string[],
  spec: DemoLeadSpec,
): NewLead {
  // Spread capture times across the last month so the default createdAt sort
  // and the "Captured" column show variety.
  const capturedAt = new Date(Date.now() - spec.n * 26 * 60 * 60 * 1000);
  return {
    organizationId: orgId,
    campaignIds,
    sourceType: spec.sourceType,
    sourceUrl:
      spec.sourceType === "google_maps"
        ? "https://www.google.com/maps/search/"
        : spec.sourceType === "generic_web"
          ? spec.website ?? null
          : null,
    capturedAt,
    capturedByUserId,
    clientCaptureId: `${DEMO_CAPTURE_PREFIX}${String(spec.n).padStart(3, "0")}`,
    businessName: spec.businessName,
    category: spec.category,
    categories: spec.category ? [spec.category] : [],
    phone: spec.phone ?? null,
    website: spec.website ?? null,
    address: { city: spec.city, state: spec.state },
    rating: spec.rating ?? null,
    reviewCount: spec.reviewCount ?? null,
    ownerName: spec.ownerName ?? null,
    emails: spec.emails ?? [],
    socials: spec.socials ?? {},
    techStack: spec.techStack ?? [],
    pageSpeed: {},
    businessSize: spec.businessSize ?? "unknown",
    websiteStatus: spec.websiteStatus ?? "unknown",
    enrichmentStatus: spec.enrichmentStatus ?? null,
    enrichedAt: spec.enrichmentStatus === "done" ? capturedAt : null,
    offerLine: spec.offerLine ?? null,
    score: spec.score ?? null,
    scoreReasoning: spec.scoreReasoning ?? null,
    status: spec.status,
    notes: spec.notes ?? "",
    customFields: {},
    parseIssues: spec.parseIssues ?? [],
    rawSnippet: spec.rawSnippet ?? null,
    dedupeKeys: [],
  };
}

/** Look up a campaign by name in this org, or create it. Idempotent by name. */
async function ensureCampaign(input: NewCampaign): Promise<Campaign> {
  const existing = await db.listCampaigns(input.organizationId);
  const match = existing.find((c) => c.name === input.name);
  if (match) return match;
  return db.createCampaign(input);
}

/**
 * Seed the demo Lead Directory for `org`: two campaigns, ~30 leads spanning
 * every workflow state, a couple of saved views, and one custom field. Fully
 * idempotent — leads upsert on `clientCaptureId`, and everything else is
 * looked up before insert — so it is safe on every `npm run seed`.
 */
async function seedDemoLeadDirectory(
  org: Organization,
  adminUserId: string,
): Promise<{ leadCount: number; created: boolean }> {
  const existingDemo = await db.countLeads(org.id, {
    client_capture_id: { $regex: `^${DEMO_CAPTURE_PREFIX}` },
  });
  if (existingDemo >= DEMO_LEADS.length) {
    return { leadCount: existingDemo, created: false };
  }

  const campaignA = await ensureCampaign({
    organizationId: org.id,
    name: "Austin Home Services",
    description: "Local home-service businesses captured around Austin, TX.",
    query: "home services",
    location: "Austin, TX",
    sourceType: "google_maps",
    status: "active",
    leadCount: 0,
    createdByUserId: adminUserId,
  });
  const campaignB = await ensureCampaign({
    organizationId: org.id,
    name: "Dallas Dental & Dining",
    description: "Dentists and restaurants across the Dallas–Fort Worth metro.",
    query: "dentists and restaurants",
    location: "Dallas, TX",
    sourceType: "csv",
    status: "active",
    leadCount: 0,
    createdByUserId: adminUserId,
  });

  const campaignIdsFor = (which: DemoCampaign): string[] => {
    if (which === "a") return [campaignA.id];
    if (which === "b") return [campaignB.id];
    return [campaignA.id, campaignB.id];
  };

  for (const spec of DEMO_LEADS) {
    const data = buildDemoLead(
      org.id,
      adminUserId,
      campaignIdsFor(spec.campaign),
      spec,
    );
    await db.upsertLeadByClientCaptureId(
      org.id,
      data.clientCaptureId!,
      data,
    );
  }

  // Set each campaign's denormalized leadCount from the demo data (deterministic
  // and idempotent — never an unbounded increment on re-run).
  const countA = DEMO_LEADS.filter(
    (l) => l.campaign === "a" || l.campaign === "both",
  ).length;
  const countB = DEMO_LEADS.filter(
    (l) => l.campaign === "b" || l.campaign === "both",
  ).length;
  await db.updateCampaign(org.id, campaignA.id, { leadCount: countA });
  await db.updateCampaign(org.id, campaignB.id, { leadCount: countB });

  return { leadCount: DEMO_LEADS.length, created: true };
}

/** Seed 1 custom field ("priority") for the org. Idempotent by key. */
async function seedDemoCustomFields(orgId: string): Promise<void> {
  const existing = await db.listLeadCustomFields(orgId);
  if (existing.some((f) => f.key === "priority")) return;
  const priority: NewLeadCustomField = {
    organizationId: orgId,
    key: "priority",
    label: "Priority",
    type: "select",
    options: ["low", "medium", "high"],
    sortOrder: 0,
  };
  await db.createLeadCustomField(priority);
}

/** Seed a couple of saved views for the admin. Idempotent by (user, name). */
async function seedDemoSavedViews(
  orgId: string,
  userId: string,
): Promise<void> {
  const existing = await db.listSavedViews(orgId, userId);
  const byName = new Set(existing.map((v) => v.name));

  const views: NewSavedView[] = [
    {
      organizationId: orgId,
      userId,
      name: "Ready to export",
      columns: [...DEFAULT_VISIBLE_COLUMNS],
      filters: { status: "ready" },
      sort: { key: "businessName", dir: "asc" },
      pageSize: 25,
      isDefault: true,
    },
    {
      organizationId: orgId,
      userId,
      name: "Needs review",
      columns: [
        "businessName",
        "phone",
        "website",
        "category",
        "city",
        "status",
      ],
      filters: { status: "needs_review" },
      sort: { key: "createdAt", dir: "desc" },
      pageSize: 50,
      isDefault: false,
    },
  ];

  for (const view of views) {
    if (!byName.has(view.name)) {
      await db.createSavedView(view);
    }
  }
}

/**
 * Seed the Google Maps selector pack (server-pushed selectors, decision #7).
 * Platform-level (§15) — no org. Idempotent by `sourceId`: present = skip, so a
 * super admin's later selector edits are never clobbered on re-seed.
 */
async function seedSourcePacks(): Promise<void> {
  const googleMaps: NewSourcePack = {
    sourceId: "google-maps",
    version: 1,
    automationTier: "a",
    // Keys mirror the extension's bundled fallback (google-maps/selectors.ts);
    // each value is a comma-separated list the adapter tries in order, so
    // data-item-id / aria-label variants survive Google's class-name churn.
    selectors: {
      resultItem:
        'div[role="feed"] > div > div[jsaction], a.hfpxzc, div[role="feed"] a[href*="/maps/place/"]',
      name: 'div.fontHeadlineSmall, [role="heading"], a.hfpxzc[aria-label]',
      category: 'div.fontBodyMedium > div:nth-of-type(1) > span:nth-of-type(1)',
      rating:
        "span[role='img'][aria-label*='star'], span[aria-label$='stars'], span.fontDisplayLarge",
      reviewCount: "span[aria-label*='review'], span[aria-label*='Review']",
      address:
        "button[data-item-id='address'], button[aria-label^='Address']",
      link: "a.hfpxzc, a[href*='/maps/place/']",
      phone: "button[data-item-id^='phone'], button[aria-label^='Phone']",
      website:
        "a[data-item-id='authority'], a[aria-label^='Website']",
      hours: "div[jsaction*='openhours'], [aria-label*='Hours']",
      plusCode:
        "button[data-item-id='oloc'], button[aria-label^='Plus code']",
    },
    notes:
      "Bundled fallback lives in the extension; edit this pack to fix a Google DOM change without a new build.",
    isActive: true,
  };
  const existing = await db.getSourcePackBySourceId(googleMaps.sourceId);
  if (!existing) await db.createSourcePack(googleMaps);
}

/**
 * Seed two starter offer-line prompts for `org` (Phase 3). Idempotent by name,
 * and the first is marked `isDefault` (at most one default per org). Uses only
 * the allowed `{{placeholders}}` so the prompt-save validation passes.
 */
async function seedOfferPrompts(
  orgId: string,
  createdByUserId: string,
): Promise<void> {
  const existing = await db.listOfferPrompts(orgId);
  const byName = new Set(existing.map((p) => p.name));
  const alreadyHasDefault = existing.some((p) => p.isDefault);

  const prompts: NewOfferPrompt[] = [
    {
      organizationId: orgId,
      name: "No-website opener",
      promptText:
        "Hi {{ownerName}}, I came across {{businessName}} ({{category}}) in {{city}} — " +
        "with {{reviewCount}} reviews and a {{rating}}★ rating you clearly do great work, " +
        "but I couldn't find a website. I help local {{category}} businesses get a simple, " +
        "fast site that turns Google searches into calls — want me to send a quick mockup?",
      isDefault: !alreadyHasDefault,
      provider: null,
      model: null,
      createdByUserId,
    },
    {
      organizationId: orgId,
      name: "Website-refresh opener",
      promptText:
        "Hi {{ownerName}}, your team at {{businessName}} in {{city}} has earned a {{rating}}★ " +
        "reputation, but {{website}} looks like it's due for a refresh (it's running {{techStack}}). " +
        "I rebuild sites for {{category}} businesses so they load fast and book more jobs — " +
        "happy to show you a before/after if you're open to it.",
      isDefault: false,
      provider: null,
      model: null,
      createdByUserId,
    },
  ];

  for (const prompt of prompts) {
    if (byName.has(prompt.name)) continue;
    const created = await db.createOfferPrompt(prompt);
    if (created.isDefault) await db.clearDefaultOfferPrompts(orgId, created.id);
  }
}

/**
 * The full baseline + demo seed. Exported so `scripts/seed-test.ts` can reuse
 * the exact same routine after wiping the test database. Intentionally does NOT
 * disconnect — the caller owns the connection lifecycle (the CLI runner below
 * and seed-test both close it once they are done).
 */
export async function runSeed(): Promise<void> {
  console.log(`Seeding via the "${env.DB_PROVIDER}" adapter…`);


  const admin = await ensureUser("admin@example.com", "Admin User");
  const member = await ensureUser("user@example.com", "Regular User");

  const org = await ensureOrganization({
    name: "Test Organization",
    slug: "test-org",
  });

  await ensureMember({
    organizationId: org.id,
    userId: admin.id,
    role: ORG_ROLES.admin,
  });
  await ensureMember({
    organizationId: org.id,
    userId: member.id,
    role: ORG_ROLES.user,
  });

  // Promote the platform super-admin (§14) — from SUPER_ADMIN_EMAIL, or the
  // seeded admin as a sensible local default. Never hardcoded in app code.
  const superAdminEmail = env.SUPER_ADMIN_EMAIL ?? admin.email;
  const superAdminUser = await db.getUserByEmail(superAdminEmail);
  if (superAdminUser) {
    await db.updateUser(superAdminUser.id, { isSuperAdmin: true });
  }

  // A pending invitation so the members UI has data to render.
  const invite = await ensurePendingInvitation({
    organizationId: org.id,
    email: "invitee@example.com",
    role: ORG_ROLES.user,
    token: `seed-invite-${randomUUID()}`,
    status: INVITATION_STATUSES.pending,
    invitedByUserId: admin.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  // Seeded local users are treated as email-verified so credential login and
  // trial logic behave like a real verified account.
  for (const seeded of [admin, member]) {
    const record = await db.getUserById(seeded.id);
    if (record && !record.emailVerifiedAt) {
      await db.updateUser(seeded.id, { emailVerifiedAt: new Date() });
    }
  }

  // Platform pricing plans (§15). Prices/names/caps are data (super admin edits
  // them in the admin panel; Stripe ids are minted by scripts/sync-plans.ts) —
  // nothing in app logic hardcodes them. Slugs are the stable lookups. Prices
  // are integer minor units (cents); aiCallsPerMonth is the per-plan AI cap.
  // Idempotent by slug.
  const planSeeds: NewPlan[] = [
    {
      slug: PLAN_SLUGS.free,
      name: "Free",
      description: "Try it out with a small monthly allowance.",
      priceMonthly: 0,
      priceAnnual: null,
      annualDiscountPercent: null,
      limits: {
        aiCallsPerMonth: 5,
        leadLimit: 100,
        campaignLimit: 2,
        enrichment: false,
        offerLines: false,
        dataExport: false,
      },
      isActive: true,
      sortOrder: 0,
    },
    {
      slug: PLAN_SLUGS.starter,
      name: "Starter",
      description: "For getting your first lead lists off the ground.",
      priceMonthly: 399,
      priceAnnual: 3830,
      annualDiscountPercent: 20,
      limits: {
        aiCallsPerMonth: 50,
        leadLimit: 2000,
        campaignLimit: 10,
        enrichment: false,
        offerLines: false,
        dataExport: false,
      },
      isActive: true,
      sortOrder: 1,
    },
    {
      slug: PLAN_SLUGS.pro,
      name: "Pro",
      description: "For serious, high-volume lead generation.",
      priceMonthly: 699,
      priceAnnual: 6710,
      annualDiscountPercent: 20,
      limits: {
        aiCallsPerMonth: 150,
        leadLimit: 25000,
        campaignLimit: 50,
        enrichment: true,
        offerLines: true,
        dataExport: true,
      },
      isActive: true,
      sortOrder: 2,
    },
    {
      slug: PLAN_SLUGS.premium,
      name: "Premium",
      description: "Unlimited throughput for power users and teams.",
      priceMonthly: 999,
      priceAnnual: 9590,
      annualDiscountPercent: 20,
      limits: {
        // -1 = unlimited (see the numeric limit helpers in
        // lib/usage/enforce.ts).
        aiCallsPerMonth: 300,
        leadLimit: -1,
        campaignLimit: -1,
        enrichment: true,
        offerLines: true,
        dataExport: true,
      },
      isActive: true,
      sortOrder: 3,
    },
  ];
  for (const planSeed of planSeeds) {
    const existing = await db.getPlanBySlug(planSeed.slug);
    if (!existing) {
      await db.createPlan(planSeed);
      continue;
    }
    // Backfill only limit keys the plan doesn't have yet, so a deployment
    // seeded before an entitlement existed picks it up on the next `npm run
    // seed`. Everything a super admin owns — price, name, description, active,
    // sort order, Stripe ids, and any limit they've already tuned — is left
    // exactly as-is, which keeps this safe to re-run any number of times.
    const seededLimits = planSeed.limits ?? {};
    const currentLimits = existing.limits ?? {};
    const missing = Object.entries(seededLimits).filter(
      ([key]) => !(key in currentLimits),
    );
    if (missing.length > 0) {
      await db.updatePlan(existing.id, {
        limits: { ...currentLimits, ...Object.fromEntries(missing) },
      });
      console.log(
        `  ↳ ${planSeed.slug}: added limits ${missing.map(([k]) => k).join(", ")}`,
      );
    }
  }

  // Admin-default "Valid Job" filters (product spec §4). Idempotent by label.
  const defaultFilters = [
    {
      label: "Visa Sponsorship Available",
      description:
        "Yes when the posting says it sponsors visas (H1-B or similar). No when it says it cannot sponsor. Neutral when sponsorship is never mentioned — most postings say nothing, and silence is not a refusal.",
    },
    {
      label: "US Citizenship Required",
      description:
        "Yes when the posting requires US citizenship. No when it explicitly says citizenship is not required. Neutral when it isn't mentioned. (Yes here is a restriction, not a positive.)",
    },
    {
      label: "Security Clearance Required",
      description:
        "Yes when the posting requires an active or obtainable clearance. No when it explicitly says none is needed. Neutral when it isn't mentioned. (Yes here is a restriction, not a positive.)",
    },
    {
      label: "Work Authorization Match",
      description:
        "Compares the posting against the candidate's stated work authorization. Yes when they're compatible, No when the posting's requirement rules the candidate out, Neutral when the posting states no requirement.",
    },
    {
      label: "Remote/Hybrid/Onsite Match",
      description:
        "Compares the posting against the candidate's preferred arrangement. Yes when they match, No when the posting conflicts (e.g. fully onsite for a remote-only candidate), Neutral when the posting doesn't state where the work happens.",
    },
    {
      label: "Salary Range Disclosed",
      description:
        "Yes when the posting states a salary or compensation range. No is not really applicable here — a posting that omits pay is Neutral, not No.",
    },
  ];
  const existingAdminFilters = await db.listAdminJobFilters();
  const existingLabels = new Set(existingAdminFilters.map((f) => f.label));
  for (const filter of defaultFilters) {
    if (!existingLabels.has(filter.label)) {
      await db.createJobFilter({
        label: filter.label,
        description: filter.description,
        type: JOB_FILTER_TYPES.admin,
        ownerId: null,
        isActive: true,
      });
    }
  }

  // Ensure the platform settings singleton exists. `trialDays` (default 7) is
  // the length of the local no-card trial started at email verification;
  // the legacy Stripe-checkout trial is disabled in lib/payments/checkout.ts.
  let settings = await db.getAppSettings();

  // Default lead-scoring rubric (Phase 3). Only written when unset, so a super
  // admin's tuned rubric is never clobbered on re-seed.
  if (!settings.leadScoringRubric || !settings.leadScoringRubric.trim()) {
    settings = await db.updateAppSettings({
      leadScoringRubric: DEFAULT_SCORING_RUBRIC,
    });
  }

  // ScrapperNinja demo Lead Directory (idempotent). It is plain tenant data
  // behind the seeded org, so it is harmless in an ApplyNinjaa fork too — the
  // /leads UI simply isn't routable when features.scraper is off.
  const demo = await seedDemoLeadDirectory(org, admin.id);
  await seedDemoCustomFields(org.id);
  await seedDemoSavedViews(org.id, admin.id);
  await seedOfferPrompts(org.id, admin.id);

  // Platform-level selector packs (server-pushed selectors, §15). Idempotent.
  await seedSourcePacks();

  console.log("Seed complete:");
  console.log(`  organization  ${org.id} (${org.slug})`);
  console.log(`  admin user    ${admin.id} (${admin.email})`);
  console.log(`  regular user  ${member.id} (${member.email})`);
  console.log(
    `  super admin   ${
      superAdminUser
        ? superAdminEmail +
          (env.SUPER_ADMIN_EMAIL
            ? ""
            : " (default; set SUPER_ADMIN_EMAIL to override)")
        : `not promoted — ${superAdminEmail} not found`
    }`,
  );
  console.log(
    `  invitation    ${invite.email} → ${invite.status} (${org.slug})`,
  );
  const plans = await db.listPlans();
  console.log(
    `  plans         ${plans.map((p) => `${p.name} (${p.slug})`).join(", ") || "none"}`,
  );
  const filters = await db.listAdminJobFilters();
  console.log(`  job filters   ${filters.length} admin defaults`);
  console.log(
    `  app settings  trialDays=${settings.trialDays}, leadScoringRubric ${
      settings.leadScoringRubric ? "set" : "unset"
    }`,
  );
  const offerPrompts = await db.listOfferPrompts(org.id);
  console.log(
    `  offer prompts ${offerPrompts.map((p) => p.name).join(", ") || "none"}`,
  );
  const campaigns = await db.listCampaigns(org.id);
  const customFields = await db.listLeadCustomFields(org.id);
  const savedViews = await db.listSavedViews(org.id, admin.id);
  console.log(
    `  demo leads    ${demo.leadCount} across ${campaigns.length} campaigns` +
      (demo.created ? "" : " (already seeded — skipped)"),
  );
  console.log(
    `  saved views   ${savedViews.length}; custom fields ${customFields.length}`,
  );
  const sourcePacks = await db.listSourcePacks();
  console.log(
    `  source packs  ${sourcePacks.map((p) => p.sourceId).join(", ") || "none"}`,
  );
  console.log(`  password for both: ${SEED_PASSWORD}`);
}

/**
 * CLI entrypoint — only runs when this file is executed directly
 * (`tsx scripts/seed.ts` / `npm run seed`), NOT when `runSeed` is imported by
 * `scripts/seed-test.ts`. Owns the connection close + exit code.
 */
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runSeed()
    .then(async () => {
      await db.disconnect?.();
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("Seed failed:", error);
      process.exit(1);
    });
}
