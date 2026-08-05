/**
 * Google Maps source adapter — tier "a", supports deep capture.
 *
 * Fast mode: read the business cards currently rendered in the results feed
 * (name, category, rating, review count, address snippet, hours, phone, website
 * link, coordinates, href). The service worker drives scrolling between harvests
 * (SCROLL), so `harvestList` only reads the current viewport and de-dupes are
 * handled upstream by `ref`.
 *
 * Deep mode: open each result, read the detail panel for phone / website /
 * hours / plus code / full address / category, then go back to the list.
 *
 * All selectors come from the server pack when present, with the bundled
 * GOOGLE_MAPS_SELECTORS appended as fallbacks. Two rules keep a churning DOM
 * from producing confidently-wrong data:
 *   1. every value is VALIDATED by shape (`classifyCardInfo`, `looksLike*`)
 *      before it is mapped onto a field — a selector that now matches the
 *      rating row yields null, not a review count in `category`;
 *   2. the detail pass verifies the panel actually belongs to the clicked
 *      result before merging anything, so one place's phone can never land on
 *      another's row.
 * Everything is defensive: a missing element is a null field, never a thrown
 * capture.
 */

import {
  cleanText,
  pick,
  pickAll,
  pickAllText,
  pickAttr,
  pickLabelOrText,
  pickText,
  sleep,
  topLevelOnly,
  visibleText,
  waitFor,
} from "../dom";
import {
  classifyCardInfo,
  extractPhone,
  looksLikeAddress,
  looksLikeCategory,
  parseLatLng,
  parseRatingLabel,
  parseReviewCount,
} from "../text";
import type {
  HarvestContext,
  RawRecord,
  SelectorPack,
  SourceAdapter,
} from "../types";

import { GOOGLE_MAPS_SELECTORS } from "./selectors";

/**
 * Selector list for a key: the server pack's entries FIRST, then the bundled
 * fallbacks. Appending rather than replacing means a rotted pack entry degrades
 * to the bundled selector instead of silently returning nothing.
 */
function sel(pack: SelectorPack | null, key: string): string[] {
  const parts = [pack?.selectors?.[key], GOOGLE_MAPS_SELECTORS[key]];
  const out: string[] = [];
  for (const part of parts) {
    for (const selector of (part ?? "").split(",")) {
      const trimmed = selector.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

function feedEl(pack: SelectorPack | null): Element | null {
  return pick(document, sel(pack, "feed"));
}

/** True for a link back into Google (a directions link is not a website). */
function isGoogleUrl(url: string): boolean {
  try {
    return /(^|\.)(google\.[a-z.]+|goo\.gl)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Strip a leading field label ("Phone: 512…" -> "512…"). */
function stripLabel(value: string | null, label: string): string | null {
  if (!value) return null;
  return cleanText(value.replace(new RegExp(`^${label}:?\\s*`, "i"), ""));
}

/** Read one card element into a RawRecord (no navigation). */
function readCard(card: Element, pack: SelectorPack | null): RawRecord | null {
  const link = (pick(card, sel(pack, "link")) ??
    (card.matches("a[href]") ? card : null)) as HTMLAnchorElement | null;
  const href = link?.href ?? null;
  const name =
    pickText(card, sel(pack, "name")) ??
    cleanText(link?.getAttribute("aria-label"));
  if (!name && !href) return null;

  // Maps packs the rating and the review count into ONE aria-label
  // ("4.6 stars 21 Reviews"), so both are parsed from that single label.
  const ratingLabel =
    pickAttr(card, sel(pack, "rating"), "aria-label") ??
    pickText(card, sel(pack, "rating"));
  const parsed = parseRatingLabel(ratingLabel);
  const reviewCount =
    parsed.reviewCount ??
    parseReviewCount(
      pickAttr(card, sel(pack, "reviewCount"), "aria-label") ??
        pickText(card, sel(pack, "reviewCount")),
    );

  // Category / address / hours / phone live in unlabelled info rows whose order
  // varies per result, so they are classified by shape, not by position.
  const info = classifyCardInfo(pickAllText(card, sel(pack, "cardInfo")));
  const hinted = pickText(card, sel(pack, "category"));
  const category =
    hinted && looksLikeCategory(hinted) ? hinted : info.category;

  // The card's action row holds both "Website" and "Directions"; a fallback
  // selector can match either, so anything pointing back at Google is dropped.
  const websiteHref = (pick(card, sel(pack, "cardWebsite")) as
    | HTMLAnchorElement
    | null)?.href;
  const website = websiteHref && !isGoogleUrl(websiteHref) ? websiteHref : null;
  const coords = parseLatLng(href);

  return {
    businessName: name,
    category,
    rating: parsed.rating,
    reviewCount,
    phone: info.phone,
    website: website ?? null,
    address: info.address ? { raw: info.address } : undefined,
    hours: info.hours,
    priceLevel: info.priceLevel,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    sourceUrl: href,
    ref: href,
  };
}

/**
 * The open place's panel. Maps keeps BOTH the results list and the place pane
 * mounted as `div[role="main"]`, and the list comes first in document order —
 * reading the first match is how a detail pass finds no phone, no website and
 * no address on every single result. Pick the candidate that actually holds
 * detail rows.
 */
function detailPanelEl(pack: SelectorPack | null): Document | Element {
  const candidates = pickAll(document, sel(pack, "detailPanel"));
  const scored = candidates
    .map((el) => ({
      el,
      score:
        (pick(el, sel(pack, "detailName")) ? 2 : 0) +
        (el.querySelector("[data-item-id]") ? 3 : 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.el ?? candidates[0] ?? document;
}

/** The business name currently shown in the open detail panel. */
function detailName(pack: SelectorPack | null): string | null {
  return pickText(document, sel(pack, "detailName"));
}

/** Read the currently-open place detail panel into a partial record. */
function readDetail(pack: SelectorPack | null): Partial<RawRecord> {
  const panel = detailPanelEl(pack);
  const phone = stripLabel(pickLabelOrText(panel, sel(pack, "phone")), "Phone");
  const websiteHref = (pick(panel, sel(pack, "website")) as
    | HTMLAnchorElement
    | null)?.href;
  const website = websiteHref && !isGoogleUrl(websiteHref) ? websiteHref : null;
  const address = stripLabel(
    pickLabelOrText(panel, sel(pack, "address")),
    "Address",
  );
  const plusCode = stripLabel(
    pickLabelOrText(panel, sel(pack, "plusCode")),
    "Plus code",
  );
  const hours = pickLabelOrText(panel, sel(pack, "hours"));
  const category = pickText(panel, sel(pack, "detailCategory"));
  const ratingLabel =
    pickAttr(panel, sel(pack, "detailRating"), "aria-label") ??
    pickText(panel, sel(pack, "detailRating"));
  const parsed = parseRatingLabel(ratingLabel);
  const coords = parseLatLng(location.href);

  return {
    businessName: pickText(panel, sel(pack, "detailName")) ?? undefined,
    category: category && looksLikeCategory(category) ? category : undefined,
    phone: extractPhone(phone) ?? phone,
    website: website ?? null,
    // A detail address is a full postal line; keep it only when it reads like
    // one, so a mislabelled button can't overwrite the card's address.
    address:
      address && (looksLikeAddress(address) || address.includes(","))
        ? { raw: address }
        : undefined,
    plusCode,
    hours,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    rating: parsed.rating,
    reviewCount:
      parsed.reviewCount ??
      parseReviewCount(
        pickAttr(panel, sel(pack, "detailReviewCount"), "aria-label") ??
          pickText(panel, sel(pack, "detailReviewCount")),
      ),
  };
}

/** Loose name compare — the panel title may add a suffix or differ in case. */
function sameName(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const left = norm(a);
  const right = norm(b);
  return left === right || left.startsWith(right) || right.startsWith(left);
}

/** Find the card anchor for a captured `ref`, comparing resolved hrefs. */
function findCardLink(href: string): HTMLAnchorElement | null {
  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/place/"]'),
  );
  return (
    anchors.find((a) => a.href === href) ??
    anchors.find((a) => a.getAttribute("href") === href) ??
    null
  );
}

export const googleMapsAdapter: SourceAdapter = {
  id: "google_maps",
  automationTier: "a",
  supportsDeep: true,

  match(url: string): boolean {
    try {
      const { hostname, pathname } = new URL(url);
      return hostname.endsWith("google.com") && pathname.startsWith("/maps");
    } catch {
      return false;
    }
  },

  async harvestList(ctx: HarvestContext): Promise<RawRecord[]> {
    const feed = feedEl(ctx.pack);
    const selectors = sel(ctx.pack, "resultItem");
    // `topLevelOnly` drops the anchors nested inside their own card, which the
    // selector list also matches — otherwise every business is harvested twice,
    // the second time from a node holding none of its info rows.
    const cards = topLevelOnly(pickAll(feed ?? document, selectors));
    const records: RawRecord[] = [];
    for (const card of cards) {
      const record = readCard(card, ctx.pack);
      if (record) records.push(record);
    }
    return records;
  },

  async harvestDetail(
    ctx: HarvestContext,
    ref: RawRecord,
  ): Promise<Partial<RawRecord>> {
    const href = ref.ref;
    if (!href) return {};
    const link = findCardLink(href);
    if (!link) return {};
    const previousName = detailName(ctx.pack);
    link.click();

    // Wait for the panel to actually SWITCH to the clicked place. Waiting only
    // for "a name exists" returns instantly on the previous place's panel and
    // merges its phone/website onto this record.
    const expected = ref.businessName ?? null;
    await waitFor(() => {
      const name = detailName(ctx.pack);
      if (!name) return false;
      if (expected) return sameName(name, expected);
      return name !== previousName;
    }, 6000);
    await sleep(250);

    let patch = readDetail(ctx.pack);
    // The contact rows (phone/website) render a beat after the name; retry once
    // when both are still empty before giving up on this place.
    if (!patch.phone && !patch.website) {
      await sleep(600);
      patch = readDetail(ctx.pack);
    }
    // Only keep the patch when the panel really is this business — a failed
    // click must lose data, never mix two businesses together.
    const panelName = patch.businessName ?? null;
    const trustworthy = !expected || !panelName || sameName(panelName, expected);

    // Return to the results list so the next card is reachable.
    const back = pick(document, sel(ctx.pack, "backButton")) as
      | HTMLElement
      | null;
    if (back) {
      back.click();
    } else {
      history.back();
    }
    await waitFor(() => Boolean(feedEl(ctx.pack)), 4000);
    return trustworthy ? patch : {};
  },

  async capturePage(ctx: HarvestContext): Promise<RawRecord> {
    const detail = readDetail(ctx.pack);
    const record: RawRecord = {
      ...detail,
      sourceUrl: location.href,
      ref: location.href,
    };
    // A place page that yielded nothing structured still captures its text, so
    // the server's AI rescue has something to work with.
    if (!record.businessName || (!record.phone && !record.website)) {
      const panel = detailPanelEl(ctx.pack);
      record.rawSnippet = visibleText(
        panel instanceof Element ? panel : document.body,
        4000,
      );
      record.parseIssues = ["needs_ai_extract"];
    }
    return record;
  },

  async scroll(ctx: HarvestContext): Promise<{ reachedEnd: boolean }> {
    const feed = feedEl(ctx.pack) as HTMLElement | null;
    if (!feed) return { reachedEnd: true };
    const before = feed.scrollHeight;
    feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
    await sleep(1200);
    // Maps renders a visible end-of-list marker when the feed is exhausted.
    const reachedEnd =
      feed.scrollHeight === before ||
      /You've reached the end/i.test(feed.textContent ?? "");
    return { reachedEnd };
  },
};
