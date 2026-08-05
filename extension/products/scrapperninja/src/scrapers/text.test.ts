/**
 * text.test.ts — the capture parsers are the layer that decides which scraped
 * string becomes which lead field, and getting it wrong is silent (a review
 * count stored as the category looks like data, not a bug). Extension DOM
 * harvesting is not browser-verified in CI, so these pure parsers carry the
 * regression coverage: real Google Maps / Instagram strings in, fields out.
 */

import { describe, expect, it } from "vitest";

import {
  classifyCardInfo,
  cleanProfileTitle,
  extractEmails,
  extractPhone,
  granularRows,
  looksLikeAddress,
  looksLikeCategory,
  parseLatLng,
  parseMagnitude,
  parseProfileDescription,
  parseRatingLabel,
  parseReviewCount,
  socialPlatformOf,
  splitParts,
  unwrapRedirectUrl,
} from "./text";

describe("parseRatingLabel", () => {
  it("reads rating AND review count from one Maps aria-label", () => {
    // The bug this guards: "first integer in the string" returns 4, not 21.
    expect(parseRatingLabel("4.6 stars 21 Reviews")).toEqual({
      rating: 4.6,
      reviewCount: 21,
    });
  });

  it("reads a thousands-separated count", () => {
    expect(parseRatingLabel("4.9 stars 1,234 reviews")).toEqual({
      rating: 4.9,
      reviewCount: 1234,
    });
  });

  it("reads an abbreviated count", () => {
    expect(parseRatingLabel("4.2 stars 1.2K reviews")).toEqual({
      rating: 4.2,
      reviewCount: 1200,
    });
  });

  it("reads a parenthesised count with no unit word", () => {
    expect(parseRatingLabel("4.6 (21)")).toEqual({
      rating: 4.6,
      reviewCount: 21,
    });
  });

  it("reads a bare rating", () => {
    expect(parseRatingLabel("4.6")).toEqual({ rating: 4.6, reviewCount: null });
  });

  it("rejects an out-of-range rating rather than guessing", () => {
    expect(parseRatingLabel("2021 reviews").rating).toBeNull();
  });

  it("is null-safe", () => {
    expect(parseRatingLabel(null)).toEqual({ rating: null, reviewCount: null });
  });
});

describe("parseReviewCount", () => {
  it("parses the parenthesised card form", () => {
    expect(parseReviewCount("(1,234)")).toBe(1234);
  });

  it("parses the labelled form", () => {
    expect(parseReviewCount("287 reviews")).toBe(287);
  });

  it("does not read a rating as a review count", () => {
    expect(parseReviewCount("4.6")).toBeNull();
  });
});

describe("parseMagnitude", () => {
  it("handles separators and suffixes", () => {
    expect(parseMagnitude("1,234")).toBe(1234);
    expect(parseMagnitude("1.2K")).toBe(1200);
    expect(parseMagnitude("3M")).toBe(3_000_000);
  });
});

describe("granularRows", () => {
  it("drops the concatenated wrapper rows nesting produces", () => {
    const rows = [
      "4.6(21)Plumber · 123 Main St Open ⋅ Closes 9 PM",
      "4.6(21)",
      "Plumber · 123 Main St",
      "Open ⋅ Closes 9 PM",
    ];
    expect(granularRows(rows)).toEqual([
      "4.6(21)",
      "Plumber · 123 Main St",
      "Open ⋅ Closes 9 PM",
    ]);
  });
});

describe("splitParts", () => {
  it("splits on the separator family directories use", () => {
    expect(splitParts("Plumber · 123 Main St")).toEqual([
      "Plumber",
      "123 Main St",
    ]);
    expect(splitParts("Open ⋅ Closes 9 PM")).toEqual(["Open", "Closes 9 PM"]);
  });
});

describe("field shape heuristics", () => {
  it("never treats a review count as a category", () => {
    expect(looksLikeCategory("4.6(21)")).toBe(false);
    expect(looksLikeCategory("(1,234)")).toBe(false);
    expect(looksLikeCategory("21 reviews")).toBe(false);
  });

  it("accepts real categories", () => {
    expect(looksLikeCategory("Plumber")).toBe(true);
    expect(looksLikeCategory("Mexican restaurant")).toBe(true);
  });

  it("rejects card chrome as a category", () => {
    expect(looksLikeCategory("Website")).toBe(false);
    expect(looksLikeCategory("Directions")).toBe(false);
    expect(looksLikeCategory("Closed")).toBe(false);
  });

  it("accepts real addresses and rejects rating text", () => {
    expect(looksLikeAddress("123 Main St")).toBe(true);
    expect(looksLikeAddress("1600 Pennsylvania Ave NW")).toBe(true);
    expect(looksLikeAddress("Austin, TX 78701")).toBe(true);
    expect(looksLikeAddress("4.6(21)")).toBe(false);
    expect(looksLikeAddress("Plumber")).toBe(false);
  });

  it("extracts phone numbers without matching prices or ratings", () => {
    expect(extractPhone("(512) 555-0110")).toBe("(512) 555-0110");
    expect(extractPhone("Call +1 512-555-0110 now")).toBe("+1 512-555-0110");
    expect(extractPhone("Closes 9 PM")).toBeNull();
    expect(extractPhone("4.6")).toBeNull();
  });
});

describe("classifyCardInfo", () => {
  it("maps a typical Google Maps card by shape, not position", () => {
    const info = classifyCardInfo([
      "4.6(21)Plumber · 123 Main St Open ⋅ Closes 9 PM",
      "4.6(21)",
      "Plumber · 123 Main St",
      "Open ⋅ Closes 9 PM",
      "(512) 555-0110",
    ]);
    expect(info).toEqual({
      category: "Plumber",
      address: "123 Main St",
      phone: "(512) 555-0110",
      // Kept whole: hours use the same separator as the info parts.
      hours: "Open ⋅ Closes 9 PM",
      priceLevel: null,
    });
  });

  it("handles the rating row arriving after the category row", () => {
    const info = classifyCardInfo([
      "Mexican restaurant · $$ · 500 E 6th St",
      "4.3(902)",
    ]);
    expect(info.category).toBe("Mexican restaurant");
    expect(info.address).toBe("500 E 6th St");
    expect(info.priceLevel).toBe(2);
  });

  it("returns nulls rather than mapping review counts onto fields", () => {
    // A card that only rendered its rating must produce NO category/address.
    expect(classifyCardInfo(["4.6(21)", "4.6", "(21)"])).toEqual({
      category: null,
      address: null,
      phone: null,
      hours: null,
      priceLevel: null,
    });
  });
});

describe("parseLatLng", () => {
  it("prefers the place pin over the viewport centre", () => {
    const url =
      "https://www.google.com/maps/place/Acme/@30.2500,-97.7000,17z/data=!4m7!3m6!3d30.2672!4d-97.7431";
    expect(parseLatLng(url)).toEqual({ lat: 30.2672, lng: -97.7431 });
  });

  it("falls back to the viewport centre", () => {
    expect(
      parseLatLng("https://www.google.com/maps/@30.25,-97.7,17z"),
    ).toEqual({ lat: 30.25, lng: -97.7 });
  });

  it("returns null when there are no coordinates", () => {
    expect(parseLatLng("https://www.google.com/maps/search/plumber")).toBeNull();
  });
});

describe("social helpers", () => {
  it("maps profile URLs to their platform slot", () => {
    expect(socialPlatformOf("https://www.instagram.com/acme/")).toBe(
      "instagram",
    );
    expect(socialPlatformOf("https://x.com/acme")).toBe("x");
    expect(socialPlatformOf("https://acme.com")).toBeNull();
  });

  it("unwraps the link-in-bio shim", () => {
    expect(
      unwrapRedirectUrl(
        "https://l.instagram.com/?u=https%3A%2F%2Facme.com%2F&e=ABC",
      ),
    ).toBe("https://acme.com/");
    expect(unwrapRedirectUrl("https://acme.com/path")).toBe(
      "https://acme.com/path",
    );
  });

  it("extracts emails and skips asset filenames", () => {
    expect(extractEmails("Contact hello@acme.com or logo@2x.png")).toEqual([
      "hello@acme.com",
    ]);
  });
});

describe("profile metadata", () => {
  it("cleans a social page title down to the business name", () => {
    expect(
      cleanProfileTitle("Acme Plumbing (@acmeplumbing) • Instagram photos and videos"),
    ).toBe("Acme Plumbing");
    expect(cleanProfileTitle("Acme Plumbing | LinkedIn")).toBe("Acme Plumbing");
  });

  it("reads name, handle and bio out of an og:description", () => {
    expect(
      parseProfileDescription(
        '1,234 Followers, 56 Following, 78 Posts - Acme Plumbing (@acmeplumbing) on Instagram: "Austin\'s 24/7 emergency plumber"',
      ),
    ).toEqual({
      name: "Acme Plumbing",
      handle: "acmeplumbing",
      bio: "Austin's 24/7 emergency plumber",
      followers: 1234,
    });
  });

  it("is null-safe on a plain description", () => {
    expect(parseProfileDescription("A plain page description")).toEqual({
      name: null,
      handle: null,
      bio: null,
      followers: null,
    });
  });
});
