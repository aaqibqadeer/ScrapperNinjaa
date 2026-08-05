/**
 * lib/scrape/rescue.test.ts — the parse-rescue response parser must turn a
 * DeepSeek text response into a validated record (fenced or bare JSON), default
 * absent fields to null, accept string OR structured addresses, and reject
 * malformed output rather than silently patching a lead with garbage. Pure — no
 * provider call, no DB.
 */

import { describe, expect, it } from "vitest";

import { parseRescueResponse } from "./rescue";

describe("parseRescueResponse", () => {
  it("parses a bare JSON object", () => {
    const out = parseRescueResponse(
      '{"businessName":"Acme Plumbing","phone":"512-555-0110","website":"https://acme.example","address":"1 Main St, Austin, TX"}',
    );
    expect(out.businessName).toBe("Acme Plumbing");
    expect(out.phone).toBe("512-555-0110");
    expect(out.website).toBe("https://acme.example");
    expect(out.address).toBe("1 Main St, Austin, TX");
  });

  it("extracts JSON from a ```json code fence", () => {
    const out = parseRescueResponse(
      'Here is the result:\n```json\n{"businessName":"Hill HVAC","phone":null,"website":null,"address":null}\n```',
    );
    expect(out.businessName).toBe("Hill HVAC");
    expect(out.phone).toBeNull();
  });

  it("extracts JSON embedded in surrounding prose", () => {
    const out = parseRescueResponse(
      'The listing appears to be {"businessName":"Zilker Landscaping","phone":"(512) 555-0210"} based on the text.',
    );
    expect(out.businessName).toBe("Zilker Landscaping");
    expect(out.phone).toBe("(512) 555-0210");
    // Absent optional fields default to null.
    expect(out.website).toBeNull();
    expect(out.address).toBeNull();
  });

  it("defaults every field to null for an empty object", () => {
    const out = parseRescueResponse("{}");
    expect(out).toEqual({
      businessName: null,
      category: null,
      description: null,
      ownerName: null,
      phone: null,
      website: null,
      emails: [],
      address: null,
    });
  });

  it("parses the fields a social-profile capture depends on", () => {
    const out = parseRescueResponse(
      '{"businessName":"Acme Plumbing","category":"Plumber","description":"Austin\'s 24/7 emergency plumber","emails":["hello@acme.com"]}',
    );
    expect(out.category).toBe("Plumber");
    expect(out.description).toBe("Austin's 24/7 emergency plumber");
    expect(out.emails).toEqual(["hello@acme.com"]);
  });

  it("accepts a structured address object", () => {
    const out = parseRescueResponse(
      '{"businessName":"Deep Ellum Tacos","address":{"city":"Dallas","state":"TX","postalCode":"75204"}}',
    );
    expect(out.address).toEqual({
      city: "Dallas",
      state: "TX",
      postalCode: "75204",
    });
  });

  it("throws when the response contains no JSON", () => {
    expect(() => parseRescueResponse("I could not read the listing.")).toThrow();
  });

  it("throws when a field has the wrong type", () => {
    // phone must be a string|null — a number is invalid, not coerced.
    expect(() =>
      parseRescueResponse('{"businessName":"X","phone":5125550110}'),
    ).toThrow();
  });
});
