/**
 * Google Maps source adapter — tier "a", supports deep capture.
 *
 * Fast mode: read the business cards currently rendered in the results feed
 * (name, category, rating, review count, address snippet, href). The service
 * worker drives scrolling between harvests (SCROLL), so `harvestList` only
 * reads the current viewport and de-dupes are handled upstream by `ref`.
 *
 * Deep mode: open each result, read the detail panel for phone / website /
 * hours / plus code / full address, then go back to the list.
 *
 * All selectors come from the server pack when present, falling back to the
 * bundled GOOGLE_MAPS_SELECTORS. Everything is defensive: a missing element is
 * a null field, never a thrown capture.
 */

import {
  cleanText,
  parseCount,
  parseNumber,
  pick,
  pickAttr,
  pickText,
  sleep,
  waitFor,
} from "../dom";
import type {
  HarvestContext,
  RawRecord,
  SelectorPack,
  SourceAdapter,
} from "../types";

import { GOOGLE_MAPS_SELECTORS } from "./selectors";

/** Resolve a selector key from the pack, else the bundled fallback, as a list. */
function sel(pack: SelectorPack | null, key: string): string[] {
  const raw = pack?.selectors?.[key] ?? GOOGLE_MAPS_SELECTORS[key] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function feedEl(pack: SelectorPack | null): Element | null {
  return pick(document, sel(pack, "feed"));
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

  // Maps packs category · address · phone into ".W4Efsd" info rows; use them as
  // a fallback for the card address snippet.
  const infoRows = Array.from(
    card.querySelectorAll(sel(pack, "cardInfo").join(",") || ".W4Efsd"),
  )
    .map((el) => cleanText(el.textContent))
    .filter((t): t is string => Boolean(t));
  const category =
    pickText(card, sel(pack, "category")) ??
    infoRows[0]?.split("·").map((s) => s.trim())[0] ??
    null;
  const addressSnippet =
    infoRows
      .flatMap((row) => row.split("·").map((s) => s.trim()))
      .find((part) => /\d/.test(part)) ?? null;

  return {
    businessName: name,
    category,
    rating: parseNumber(
      pickAttr(card, sel(pack, "rating"), "aria-label") ??
        pickText(card, sel(pack, "rating")),
    ),
    reviewCount: parseCount(
      pickAttr(card, sel(pack, "reviewCount"), "aria-label") ??
        pickText(card, sel(pack, "reviewCount")),
    ),
    address: addressSnippet ? { raw: addressSnippet } : undefined,
    sourceUrl: href,
    ref: href,
  };
}

/** Read the currently-open place detail panel into a partial record. */
function readDetail(pack: SelectorPack | null): Partial<RawRecord> {
  const panel = pick(document, sel(pack, "detailPanel")) ?? document;
  const phone = pickAttr(panel, sel(pack, "phone"), "aria-label");
  const website = (pick(panel, sel(pack, "website")) as
    | HTMLAnchorElement
    | null)?.href;
  const address = pickAttr(panel, sel(pack, "address"), "aria-label");
  const plusCode = pickAttr(panel, sel(pack, "plusCode"), "aria-label");
  const hours =
    pickAttr(panel, sel(pack, "hours"), "aria-label") ??
    pickText(panel, sel(pack, "hours"));

  const stripLabel = (value: string | null, label: string): string | null =>
    value ? cleanText(value.replace(new RegExp(`^${label}:?\\s*`, "i"), "")) : null;

  return {
    businessName: pickText(panel, sel(pack, "detailName")) ?? undefined,
    category: pickText(panel, sel(pack, "category")) ?? undefined,
    phone: stripLabel(phone, "Phone"),
    website: website ?? null,
    address: address ? { raw: stripLabel(address, "Address") } : undefined,
    plusCode: stripLabel(plusCode, "Plus code"),
    hours,
    rating: parseNumber(pickText(panel, sel(pack, "detailRating"))),
    reviewCount: parseCount(
      pickAttr(panel, sel(pack, "detailReviewCount"), "aria-label") ??
        pickText(panel, sel(pack, "detailReviewCount")),
    ),
  };
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
    const cardSelector = sel(ctx.pack, "resultItem").join(",");
    const cards = feed
      ? Array.from(feed.querySelectorAll(cardSelector))
      : Array.from(document.querySelectorAll(cardSelector));
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
    const link = document.querySelector<HTMLAnchorElement>(
      `a[href="${CSS.escape(href)}"]`,
    );
    if (!link) return {};
    link.click();
    // Wait for the detail panel to reflect the clicked place.
    await waitFor(() => {
      const name = pickText(document, sel(ctx.pack, "detailName"));
      return Boolean(name);
    }, 5000);
    await sleep(250);
    let patch = readDetail(ctx.pack);
    // The contact rows (phone/website) render a beat after the name; retry once
    // when both are still empty before giving up on this place.
    if (!patch.phone && !patch.website) {
      await sleep(600);
      patch = readDetail(ctx.pack);
    }
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
    return patch;
  },

  async capturePage(ctx: HarvestContext): Promise<RawRecord> {
    const detail = readDetail(ctx.pack);
    return {
      ...detail,
      sourceUrl: location.href,
      ref: location.href,
    };
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
