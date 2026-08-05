/**
 * Structured page metadata — the "read what the page already publishes about
 * itself" pass, shared by the manual (tier-d) and generic adapters.
 *
 * Social and directory pages render their content through obfuscated,
 * constantly-churning class names, so selector scraping gets almost nothing from
 * them. What they DO publish reliably, because search engines require it, is
 * metadata: Open Graph tags, JSON-LD (`schema.org` Organization / LocalBusiness
 * / ProfilePage), `mailto:` / `tel:` links, and the outbound "link in bio". That
 * is where a name, description, phone, website, socials and address actually
 * come from on Instagram, Facebook and LinkedIn.
 *
 * Everything is best-effort: a missing tag is a null field, a malformed JSON-LD
 * block is skipped, and the caller still keeps `rawSnippet` so the server's AI
 * rescue can fill whatever is left.
 */

import {
  cleanProfileTitle,
  cleanText,
  extractEmails,
  extractPhone,
  parseProfileDescription,
  socialPlatformOf,
  unwrapRedirectUrl,
  type SocialLinks,
} from "./text";
import type { RawAddress } from "./types";

/** Max anchors inspected — enough for a profile header, cheap on a huge feed. */
const MAX_LINKS = 500;

export interface PageMeta {
  businessName: string | null;
  description: string | null;
  category: string | null;
  phone: string | null;
  website: string | null;
  emails: string[];
  socials: SocialLinks;
  address: RawAddress | null;
  ownerName: string | null;
  lat: number | null;
  lng: number | null;
}

function emptyMeta(): PageMeta {
  return {
    businessName: null,
    description: null,
    category: null,
    phone: null,
    website: null,
    emails: [],
    socials: {},
    address: null,
    ownerName: null,
    lat: null,
    lng: null,
  };
}

/** `<meta property|name="…" content="…">`, first match wins. */
function meta(...names: string[]): string | null {
  for (const name of names) {
    const el =
      document.querySelector(`meta[property="${name}"]`) ??
      document.querySelector(`meta[name="${name}"]`);
    const content = cleanText(el?.getAttribute("content"));
    if (content) return content;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* JSON-LD                                                                    */
/* -------------------------------------------------------------------------- */

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flatten a JSON-LD payload (arrays, `@graph`, nested entities) into nodes. */
function flattenNodes(value: unknown, out: JsonObject[], depth = 0): void {
  if (depth > 6 || out.length > 100) return;
  if (Array.isArray(value)) {
    for (const item of value) flattenNodes(item, out, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  out.push(value);
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "about", "author", "publisher", "itemListElement"]) {
    if (key in value) flattenNodes(value[key], out, depth + 1);
  }
}

function jsonLdNodes(): JsonObject[] {
  const nodes: JsonObject[] = [];
  for (const script of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )) {
    try {
      flattenNodes(JSON.parse(script.textContent ?? ""), nodes);
    } catch {
      // Malformed block — the rest of the page is still worth reading.
    }
  }
  return nodes;
}

/** Business-ish schema.org types, most specific first. */
const BUSINESS_TYPES = [
  "localbusiness",
  "organization",
  "store",
  "restaurant",
  "professionalservice",
  "homeandconstructionbusiness",
  "medicalbusiness",
  "corporation",
  "person",
  "profilepage",
];

function typesOf(node: JsonObject): string[] {
  const raw = node["@type"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase());
}

/** The node most likely to describe the business, or null. */
function pickBusinessNode(nodes: JsonObject[]): JsonObject | null {
  let best: { node: JsonObject; rank: number } | null = null;
  for (const node of nodes) {
    const types = typesOf(node);
    for (const type of types) {
      const rank = BUSINESS_TYPES.indexOf(type);
      // Unlisted types still qualify when they end in "business"/"service".
      const score =
        rank >= 0 ? rank : /business|service|store|shop$/.test(type) ? 50 : -1;
      if (score < 0) continue;
      if (!best || score < best.rank) best = { node, rank: score };
    }
  }
  return best?.node ?? null;
}

function str(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return str(value[0]);
  if (isObject(value)) return str(value.name ?? value["@id"] ?? value.url);
  return null;
}

function addressOf(value: unknown): RawAddress | null {
  if (typeof value === "string") {
    const raw = cleanText(value);
    return raw ? { raw } : null;
  }
  if (!isObject(value)) return null;
  const address: RawAddress = {
    raw: str(value.name),
    street: str(value.streetAddress),
    city: str(value.addressLocality),
    state: str(value.addressRegion),
    postalCode: str(value.postalCode),
    country: str(value.addressCountry),
  };
  const parts = [
    address.street,
    address.city,
    address.state,
    address.postalCode,
  ].filter(Boolean);
  if (parts.length === 0) return address.raw ? { raw: address.raw } : null;
  return { ...address, raw: address.raw ?? parts.join(", ") };
}

/* -------------------------------------------------------------------------- */
/* Links                                                                      */
/* -------------------------------------------------------------------------- */

/** Hosts that are the platform's own chrome, never the business's website. */
const PLATFORM_PATHS =
  /^\/(?:about|help|privacy|terms|legal|policies|developer|api|jobs|careers|explore|accounts|login|signup|directory|topics|hashtag|explore)\b/i;

interface LinkHarvest {
  emails: string[];
  phone: string | null;
  website: string | null;
  socials: SocialLinks;
}

/** Registrable-ish domain compare, so `www.` and subdomains count as "same". */
function sameSite(a: string, b: string): boolean {
  const tail = (host: string) => host.toLowerCase().split(".").slice(-2).join(".");
  return tail(a) === tail(b);
}

function harvestLinks(pageUrl: URL): LinkHarvest {
  const out: LinkHarvest = {
    emails: [],
    phone: null,
    website: null,
    socials: {},
  };
  const emails = new Set<string>();
  // Shim-wrapped links are what a profile's own "link in bio" looks like, so
  // they outrank a plain anchor when choosing the website.
  let shimWebsite: string | null = null;
  let plainWebsite: string | null = null;

  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).slice(0, MAX_LINKS);

  for (const anchor of anchors) {
    const rawHref = anchor.getAttribute("href") ?? "";
    if (rawHref.startsWith("mailto:")) {
      for (const email of extractEmails(rawHref.slice(7))) emails.add(email);
      continue;
    }
    if (rawHref.startsWith("tel:")) {
      out.phone ??= extractPhone(decodeURIComponent(rawHref.slice(4)));
      continue;
    }

    const href = anchor.href;
    if (!/^https?:/i.test(href)) continue;
    const unwrapped = unwrapRedirectUrl(href);
    const wasShim = unwrapped !== href;

    let target: URL;
    try {
      target = new URL(unwrapped);
    } catch {
      continue;
    }

    const platform = socialPlatformOf(unwrapped);
    if (platform) {
      // Skip the platform's own nav links back to itself.
      if (sameSite(target.hostname, pageUrl.hostname) && PLATFORM_PATHS.test(target.pathname)) {
        continue;
      }
      out.socials[platform] ??= `${target.origin}${target.pathname}`.replace(
        /\/$/,
        "",
      );
      continue;
    }

    if (sameSite(target.hostname, pageUrl.hostname)) continue;
    if (PLATFORM_PATHS.test(target.pathname)) continue;
    if (wasShim) shimWebsite ??= unwrapped;
    else plainWebsite ??= unwrapped;
  }

  out.emails = [...emails];
  out.website = shimWebsite ?? plainWebsite;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Read everything the current page publishes about itself. `sourceUrl` is the
 * capture URL (used to resolve relative links and to slot the page's own
 * profile into `socials`).
 */
export function readPageMeta(sourceUrl: string): PageMeta {
  const result = emptyMeta();
  let pageUrl: URL;
  try {
    pageUrl = new URL(sourceUrl || location.href);
  } catch {
    pageUrl = new URL(location.href);
  }

  /* -- Open Graph / meta tags -------------------------------------------- */
  const ogTitle = meta("og:title", "twitter:title");
  const ogDescription = meta("og:description", "twitter:description", "description");
  const profile = parseProfileDescription(ogDescription);

  result.businessName =
    profile.name ??
    cleanProfileTitle(ogTitle) ??
    cleanProfileTitle(document.title) ??
    cleanText(meta("og:site_name"));
  result.description = profile.bio ?? ogDescription;

  /* -- JSON-LD ------------------------------------------------------------ */
  const node = pickBusinessNode(jsonLdNodes());
  if (node) {
    result.businessName = str(node.name) ?? str(node.legalName) ?? result.businessName;
    result.description = str(node.description) ?? result.description;
    result.category =
      str(node.category) ?? str(node.knowsAbout) ?? str(node.industry);
    result.phone = extractPhone(str(node.telephone)) ?? str(node.telephone);
    result.ownerName = str(node.founder) ?? str(node.owner);
    result.address = addressOf(node.address);
    result.emails = extractEmails(str(node.email));

    const url = str(node.url);
    if (url && !socialPlatformOf(url)) result.website = url;

    const sameAs = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
    for (const entry of sameAs) {
      const link = str(entry);
      if (!link) continue;
      const platform = socialPlatformOf(link);
      if (platform) result.socials[platform] ??= link;
    }

    if (isObject(node.geo)) {
      const lat = Number(node.geo.latitude);
      const lng = Number(node.geo.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        result.lat = lat;
        result.lng = lng;
      }
    }
  }

  /* -- Links -------------------------------------------------------------- */
  const links = harvestLinks(pageUrl);
  result.phone ??= links.phone;
  result.website ??= links.website;
  result.emails = [...new Set([...result.emails, ...links.emails])];
  for (const [platform, url] of Object.entries(links.socials)) {
    const key = platform as keyof SocialLinks;
    result.socials[key] ??= url;
  }

  /* -- The page itself is a social profile -------------------------------- */
  const ownPlatform = socialPlatformOf(pageUrl.href);
  if (ownPlatform && !PLATFORM_PATHS.test(pageUrl.pathname)) {
    result.socials[ownPlatform] =
      `${pageUrl.origin}${pageUrl.pathname}`.replace(/\/$/, "");
  }

  return result;
}
