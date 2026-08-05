/**
 * BUNDLED FALLBACK selectors for Google Maps.
 *
 * Last-resort selectors used when the server-pushed pack
 * (GET /api/scrape/selectors, sourceId "google-maps") is unavailable — and now
 * also APPENDED AFTER the pack's own selectors (see `sel()` in ./index.ts), so a
 * pack entry that has rotted falls through to these instead of yielding null.
 * Google Maps ships obfuscated, frequently-churning class names, so these WILL
 * rot — that is exactly why the server pack exists (fix the DOM without
 * shipping a new build).
 *
 * KEYS MATCH THE SERVER PACK (scripts/seed.ts `seedSourcePacks`), so a pack
 * transparently overrides the corresponding fallback:
 *   resultItem · link · name · category · rating · reviewCount   (card level)
 *   cardInfo · cardWebsite                                       (card level)
 *   address · phone · website · hours · plusCode                 (detail panel)
 *   detailCategory                                               (detail panel)
 * The remaining keys (feed, detailPanel, detailName, detailRating,
 * detailReviewCount, backButton) are bundled-only helpers. Each value may be a
 * comma-separated list; the adapter tries them in order.
 *
 * NOTE: matching a selector is not enough — the adapter validates what it read
 * (`looksLikeCategory`, `looksLikeAddress`, …) before mapping it onto a field,
 * so a selector that still matches but now points at the rating row produces
 * null rather than a review count in `category`.
 */

export const GOOGLE_MAPS_SELECTORS: Record<string, string> = {
  // -- card level (mirrors the seeded pack keys) --------------------------
  // Cards are anchors to a /maps/place/ URL; the `jsaction` wrapper is the
  // resilient container even as class names churn.
  resultItem:
    'div[role="feed"] > div > div[jsaction], div.Nv2PK, div[role="feed"] a[href*="/maps/place/"]',
  link: "a.hfpxzc, a[href*='/maps/place/']",
  name: "div.fontHeadlineSmall, .qBF1Pd, [role='heading'], a.hfpxzc[aria-label]",
  // The category is the first non-rating part of the info rows; this selector is
  // only a hint — `classifyCardInfo` decides what is actually a category.
  category: "div.fontBodyMedium > div:nth-of-type(1) > span:nth-of-type(1)",
  // Rating lives in an aria-label ("4.6 stars 21 Reviews"), which carries BOTH
  // numbers — the adapter parses each from its unit word.
  rating:
    "span[role='img'][aria-label*='star'], span[aria-label$='stars'], .MW4etd",
  // Review count is usually "(1,234)" text or an aria-label ("1,234 reviews").
  reviewCount:
    ".UY7F9, span[aria-label*='review'], span[aria-label*='Review']",
  // Info rows carry "category · address", opening hours and sometimes a phone.
  cardInfo: ".W4Efsd",
  // Result cards link straight out to the business site — capturable in FAST
  // mode, no detail pass needed.
  cardWebsite:
    "a[data-value='Website'], a[aria-label^='Visit'], a.lcr4fd[href^='http']",
  // -- detail panel (mirrors the seeded pack keys) ------------------------
  // Detail buttons carry a stable `data-item-id`; the label/tooltip variants
  // are backups for locale/layout changes.
  address:
    "button[data-item-id='address'], [data-tooltip='Copy address'], button[aria-label^='Address']",
  phone:
    "button[data-item-id^='phone'], [data-tooltip='Copy phone number'], button[aria-label^='Phone']",
  website:
    "a[data-item-id='authority'], a[data-tooltip='Open website'], a[aria-label^='Website']",
  hours:
    "div[jsaction*='openhours'], [data-item-id='oh'], [aria-label*='Hours'], .t39EBf",
  plusCode:
    "button[data-item-id='oloc'], [data-tooltip='Copy plus code'], button[aria-label^='Plus code']",
  detailCategory:
    "button[jsaction*='category'], button.DkEaL, [jsaction*='pane.rating.category']",
  // -- bundled-only helpers (not in the server pack) ----------------------
  feed: 'div[role="feed"]',
  // Maps keeps the results list AND the open place in the DOM, both as
  // role="main" — the adapter picks the one that actually holds detail rows.
  detailPanel: 'div[role="main"]',
  detailName: "h1.DUwDvf, h1.fontHeadlineLarge, div[role='main'] h1",
  detailRating: "div.F7nice span[aria-hidden='true'], div.F7nice",
  detailReviewCount: "div.F7nice span[aria-label*='review'], div.F7nice",
  backButton: "button[aria-label='Back'], button[jsaction*='back']",
};
