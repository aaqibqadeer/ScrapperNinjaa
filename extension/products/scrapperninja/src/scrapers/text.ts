/**
 * Pure text / URL parsing shared by the capture adapters.
 *
 * NO DOM ACCESS — every function here takes strings and returns data, so the
 * hard parts of harvesting (which text is a category vs an address vs a review
 * count) are unit-testable without a browser. The DOM-touching helpers live in
 * `./dom.ts` and the adapters; both import from here.
 *
 * The rule these helpers encode: a field is only mapped when the text actually
 * LOOKS like that field. Directory markup churns constantly, so a selector that
 * still matches but now points at the wrong node must produce `null`, never a
 * confidently-wrong value (that is how review counts ended up in `category`).
 */

/* -------------------------------------------------------------------------- */
/* Basics                                                                     */
/* -------------------------------------------------------------------------- */

/** Trim + collapse whitespace; empty string becomes null. */
export function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/** Parse the first float in a string (e.g. "4.6 stars" -> 4.6). */
export function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : null;
}

/** "1,234" -> 1234 · "1.2K" -> 1200 · "3M" -> 3000000. Null when unreadable. */
export function parseMagnitude(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value
    .replace(/\s+/g, "")
    .match(/(\d[\d.,]*)\s*([kKmM])?/);
  if (!match) return null;
  const suffix = match[2]?.toLowerCase();
  // Without a K/M suffix the separators are thousands separators ("1,234"), so
  // strip them all; with one, the dot is a real decimal point ("1.2K").
  const digits = suffix
    ? match[1].replace(/,/g, "")
    : match[1].replace(/[.,]/g, "");
  const base = Number.parseFloat(digits);
  if (!Number.isFinite(base)) return null;
  const factor = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
  return Math.round(base * factor);
}

/** Separators directories put between info parts ("Plumber · 123 Main St"). */
const PART_SEPARATOR = /[·•⋅∙‧⸱|]/;

/** Split one info row into its logical parts, trimmed and non-empty. */
export function splitParts(row: string): string[] {
  return row
    .split(PART_SEPARATOR)
    .map((part) => cleanText(part))
    .filter((part): part is string => Boolean(part));
}

/**
 * Keep only the most granular rows: drop any row that fully contains a shorter
 * row. Nested containers (Maps wraps `.W4Efsd` in `.W4Efsd`) otherwise yield the
 * same text twice — once cleanly separated, once concatenated into mush.
 */
export function granularRows(rows: readonly string[]): string[] {
  const cleaned = rows
    .map((row) => cleanText(row))
    .filter((row): row is string => Boolean(row));
  return cleaned.filter(
    (row, i) =>
      !cleaned.some(
        (other, j) => j !== i && other.length < row.length && row.includes(other),
      ),
  );
}

/* -------------------------------------------------------------------------- */
/* Ratings & review counts                                                    */
/* -------------------------------------------------------------------------- */

export interface RatingInfo {
  rating: number | null;
  reviewCount: number | null;
}

const RATING_WITH_UNIT = /(\d+(?:[.,]\d+)?)\s*(?:★|stars?|out of 5)/i;
const REVIEWS_WITH_UNIT = /(\d[\d.,]*\s*[kKmM]?)\s*(?:reviews?|ratings?)/i;
const REVIEWS_IN_PARENS = /\((\d[\d.,]*\s*[kKmM]?)\)/;
const BARE_RATING = /^(\d+(?:[.,]\d+)?)$/;
/** "4.6 (21)" / "4.6(21)" — a 0-5 score leading a card's rating row. */
const LEADING_RATING = /^([0-5](?:[.,]\d)?)\s*[(\s]/;

/**
 * Read a rating AND a review count out of one label.
 *
 * Google Maps packs both into a single `aria-label` ("4.6 stars 21 Reviews"), so
 * a naive "first integer" read returns 4 as the review count. Both values are
 * parsed from their unit words, which is also what makes "(21)" and "1.2K
 * reviews" work.
 */
export function parseRatingLabel(
  label: string | null | undefined,
): RatingInfo {
  const text = cleanText(label);
  if (!text) return { rating: null, reviewCount: null };

  const ratingMatch =
    text.match(RATING_WITH_UNIT) ??
    text.match(BARE_RATING) ??
    text.match(LEADING_RATING);
  const rating = ratingMatch
    ? Number.parseFloat(ratingMatch[1].replace(",", "."))
    : null;

  const reviewsMatch =
    text.match(REVIEWS_WITH_UNIT) ?? text.match(REVIEWS_IN_PARENS);
  const reviewCount = reviewsMatch ? parseMagnitude(reviewsMatch[1]) : null;

  return {
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    reviewCount,
  };
}

/** Review count on its own ("(1,234)", "1,234 reviews", "1.2K"). */
export function parseReviewCount(
  value: string | null | undefined,
): number | null {
  const text = cleanText(value);
  if (!text) return null;
  const fromLabel = parseRatingLabel(text).reviewCount;
  if (fromLabel !== null) return fromLabel;
  // A bare number is a count only when it isn't a 0-5 rating like "4.6".
  if (/^\(?\d[\d.,]*\s*[kKmM]?\)?$/.test(text) && !/^\d\.\d$/.test(text)) {
    return parseMagnitude(text);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Field shape heuristics                                                     */
/* -------------------------------------------------------------------------- */

/** True for text that is really a rating / review count, not a field value. */
export function looksLikeRatingNoise(part: string): boolean {
  const text = part.trim();
  if (!text) return true;
  if (/\b(stars?|reviews?|ratings?)\b/i.test(text)) return true;
  // "4.6", "(21)", "1,234", "4.6(21)", "4.6 (1.2K)"
  return /^\(?\d[\d.,]*\s*[kKmM]?\)?\s*\(?\d?[\d.,]*\s*[kKmM]?\)?$/.test(text);
}

/** A clock time or weekday — the other half of an opening-hours row. */
const TIME_LIKE =
  /^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i;

/** True for an opening-hours snippet ("Open ⋅ Closes 9 PM", "Closed"). */
export function looksLikeHours(part: string): boolean {
  return /\b(open|opens|opening|closed|closes|closing|24\s*hours|hours)\b/i.test(
    part,
  );
}

const STREET_SUFFIX =
  /\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|pl|place|ste|suite|unit|fl|floor|trl|trail|cir|circle|sq|square|loop|ter|terrace|expy|expressway|rte|route)\b\.?/i;
const POSTAL_CODE = /\b\d{5}(?:-\d{4})?\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i;

/** True for text that plausibly is a postal address, not a category/hours. */
export function looksLikeAddress(part: string): boolean {
  const text = part.trim();
  if (!text || text.length > 200) return false;
  if (looksLikeRatingNoise(text) || looksLikeHours(text)) return false;
  if (!/[A-Za-z]/.test(text) || !/\d/.test(text)) return false;
  if (extractPhone(text) !== null) return false;
  if (/^\d+\s+\S/.test(text)) return true; // "123 Main St"
  return STREET_SUFFIX.test(text) || POSTAL_CODE.test(text);
}

/** Card chrome and service chips that are never the business's category. */
const CATEGORY_STOPWORDS = new Set([
  "ad",
  "ads",
  "sponsored",
  "website",
  "directions",
  "call",
  "share",
  "save",
  "order online",
  "book online",
  "menu",
  "dine-in",
  "takeout",
  "delivery",
  "curbside pickup",
  "in-store shopping",
  "in-store pickup",
  "no-contact delivery",
  "online appointments",
  "on-site services",
  "onsite services",
  "provides on-site services",
  "wheelchair accessible entrance",
  "results",
  "sponsored results",
]);

/** True for text that plausibly is a business category ("Plumber"). */
export function looksLikeCategory(part: string): boolean {
  const text = part.trim();
  if (text.length < 3 || text.length > 60) return false;
  if (/\d/.test(text)) return false; // categories carry no digits; ratings do
  if (!/[A-Za-z]/.test(text)) return false;
  if (/[@]|https?:\/\//i.test(text)) return false;
  if (looksLikeRatingNoise(text) || looksLikeHours(text)) return false;
  return !CATEGORY_STOPWORDS.has(text.toLowerCase());
}

const PHONE_CANDIDATE = /[+(]?\s*\d[\d\s().-]{6,}\d/;

/** Pull a phone number out of a text part, or null when there isn't one. */
export function extractPhone(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(PHONE_CANDIDATE);
  if (!match) return null;
  const raw = match[0].trim().replace(/[\s.-]+$/, "");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return raw;
}

/** "$$" -> 2. Null for anything that isn't a bare price-level marker. */
export function parsePriceLevel(part: string): number | null {
  const match = part.trim().match(/^(\$+)(?:\s*[–—-]\s*\$+)?$/);
  return match ? match[1].length : null;
}

export interface CardInfo {
  category: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  priceLevel: number | null;
}

/**
 * Classify a result card's info rows into fields BY SHAPE.
 *
 * Directory cards render "4.6 (21) · Plumber · 123 Main St · Open ⋅ Closes 9 PM"
 * across nested rows in an order that varies by result, so position-based
 * mapping ("row 0 is the category") silently maps review counts onto category.
 * Every part is instead tested against the field heuristics above, first match
 * wins per slot, and unrecognized parts are dropped.
 */
export function classifyCardInfo(rows: readonly string[]): CardInfo {
  const info: CardInfo = {
    category: null,
    address: null,
    phone: null,
    hours: null,
    priceLevel: null,
  };

  const seen = new Set<string>();
  for (const row of granularRows(rows)) {
    const parts = splitParts(row);
    // Opening hours use the SAME separator as the info parts
    // ("Open ⋅ Closes 9 PM"), so an all-hours row is kept whole rather than
    // shredded into "Open" and "Closes 9 PM".
    if (
      info.hours === null &&
      looksLikeHours(row) &&
      parts.every((part) => looksLikeHours(part) || TIME_LIKE.test(part))
    ) {
      info.hours = row;
      continue;
    }
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      if (looksLikeRatingNoise(part)) continue;
      if (info.priceLevel === null) {
        const price = parsePriceLevel(part);
        if (price !== null) {
          info.priceLevel = price;
          continue;
        }
      }
      if (info.hours === null && looksLikeHours(part)) {
        info.hours = part;
        continue;
      }
      if (info.phone === null) {
        const phone = extractPhone(part);
        if (phone !== null) {
          info.phone = phone;
          continue;
        }
      }
      if (info.address === null && looksLikeAddress(part)) {
        info.address = part;
        continue;
      }
      if (info.category === null && looksLikeCategory(part)) {
        info.category = part;
      }
    }
  }
  return info;
}

/* -------------------------------------------------------------------------- */
/* URLs                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Coordinates from a Google Maps URL. `!3d<lat>!4d<lng>` is the PLACE pin (what
 * we want) and `@lat,lng` is only the viewport centre, so the pin wins.
 */
export function parseLatLng(
  url: string | null | undefined,
): { lat: number; lng: number } | null {
  if (!url) return null;
  const pin = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const viewport = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const match = pin ?? viewport;
  if (!match) return null;
  const lat = Number.parseFloat(match[1]);
  const lng = Number.parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "youtube",
  "tiktok",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

const SOCIAL_HOSTS: ReadonlyArray<[RegExp, SocialPlatform]> = [
  [/(^|\.)facebook\.com$/i, "facebook"],
  [/(^|\.)fb\.com$/i, "facebook"],
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)linkedin\.com$/i, "linkedin"],
  [/(^|\.)twitter\.com$/i, "x"],
  [/(^|\.)x\.com$/i, "x"],
  [/(^|\.)youtube\.com$/i, "youtube"],
  [/(^|\.)youtu\.be$/i, "youtube"],
  [/(^|\.)tiktok\.com$/i, "tiktok"],
];

/** The social slot a URL belongs to, or null when it isn't a social profile. */
export function socialPlatformOf(url: string): SocialPlatform | null {
  try {
    const { hostname } = new URL(url);
    for (const [pattern, platform] of SOCIAL_HOSTS) {
      if (pattern.test(hostname)) return platform;
    }
  } catch {
    // Not a URL — not a social profile.
  }
  return null;
}

/** Query params the big platforms hide the real destination behind. */
const REDIRECT_PARAMS = ["u", "url", "q", "target", "to"];
/** Link shims: the "link in bio" is always wrapped in one of these. */
const REDIRECT_HOSTS =
  /^(?:l|lm|out|away|exit)\.[\w.-]+$|(?:^|\.)(?:l\.instagram\.com|l\.facebook\.com|lm\.facebook\.com|l\.messenger\.com|away\.vk\.com)$/i;

/**
 * Unwrap a link-shim URL to the destination it points at
 * (`l.instagram.com/?u=https%3A%2F%2Facme.com` -> `https://acme.com`). Anything
 * that isn't a shim is returned unchanged.
 */
export function unwrapRedirectUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const isShim =
      REDIRECT_HOSTS.test(parsed.hostname) ||
      /\/redir(ect)?\b|\/url$|\/l\.php$/i.test(parsed.pathname);
    if (!isShim) return url;
    for (const param of REDIRECT_PARAMS) {
      const value = parsed.searchParams.get(param);
      if (value && /^https?:\/\//i.test(value)) return value;
    }
  } catch {
    // Unparseable — hand it back untouched.
  }
  return url;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Every distinct email address in a blob of text, lowercased. */
export function extractEmails(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = text.match(EMAIL_RE) ?? [];
  const seen = new Set<string>();
  for (const email of found) {
    const clean = email.toLowerCase().replace(/[.,;:]+$/, "");
    // Skip the image-file false positives ("logo@2x.png").
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(clean)) continue;
    seen.add(clean);
  }
  return [...seen];
}

const PLATFORM_TITLE_SUFFIX =
  /\s*[-–|]\s*(instagram|facebook|linkedin|x|twitter|tiktok)(\s+.*)?$/i;

/**
 * Business name out of a social profile page title:
 * `Acme Plumbing (@acmeplumbing) • Instagram photos and videos` -> `Acme Plumbing`.
 */
export function cleanProfileTitle(
  title: string | null | undefined,
): string | null {
  const text = cleanText(title);
  if (!text) return null;
  const [head] = text.split(/\s+[•|]\s+/);
  const withoutHandle = head.replace(/\s*\(@[^)]+\)\s*$/, "");
  const withoutPlatform = withoutHandle.replace(PLATFORM_TITLE_SUFFIX, "");
  return cleanText(withoutPlatform);
}

export interface ProfileDescription {
  name: string | null;
  handle: string | null;
  bio: string | null;
  followers: number | null;
}

/**
 * Pull the pieces out of a social profile's `og:description`, which is the one
 * place tier-d sites reliably publish the bio:
 * `1,234 Followers, 56 Following, 78 Posts - Acme Plumbing (@acme) on Instagram: "Austin's 24/7 plumber"`.
 */
export function parseProfileDescription(
  description: string | null | undefined,
): ProfileDescription {
  const text = cleanText(description);
  const empty: ProfileDescription = {
    name: null,
    handle: null,
    bio: null,
    followers: null,
  };
  if (!text) return empty;

  const followersMatch = text.match(/([\d.,]+\s*[kKmM]?)\s*followers/i);
  const handleMatch = text.match(/\(@([A-Za-z0-9._]+)\)/);
  const bioMatch =
    text.match(/on\s+\w+:\s*["“](.+)["”]\s*$/i) ??
    text.match(/:\s*["“](.+)["”]\s*$/);
  const nameMatch = text.match(/[-–—]\s*([^:]+?)\s*\(@[A-Za-z0-9._]+\)/);

  return {
    name: cleanText(nameMatch?.[1]),
    handle: handleMatch ? handleMatch[1] : null,
    bio: cleanText(bioMatch?.[1]),
    followers: followersMatch ? parseMagnitude(followersMatch[1]) : null,
  };
}
