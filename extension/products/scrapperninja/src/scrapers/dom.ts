/**
 * Small DOM helpers shared by the content-script adapters.
 *
 * These run in the PAGE context (inside the content script), so `document` and
 * `window` are available. Kept dependency-free and defensive — directory DOMs
 * are hostile and change often. Anything that only needs strings lives in
 * `./text.ts` (pure + unit-tested); this module is the DOM half.
 */

import { cleanText, parseNumber, parseReviewCount } from "./text";

// Re-exported so adapters keep importing their text helpers from one place.
export { cleanText, parseNumber, parseReviewCount };

type ParentElement = Document | Element;

/** First element matching any of the selectors, or null. */
export function pick(root: ParentElement, selectors: string[]): Element | null {
  for (const selector of selectors) {
    if (!selector) continue;
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch {
      // Invalid selector from a server pack — skip it.
    }
  }
  return null;
}

/** Every element matching any of the selectors, in document order, de-duped. */
export function pickAll(root: ParentElement, selectors: string[]): Element[] {
  const found = new Set<Element>();
  for (const selector of selectors) {
    if (!selector) continue;
    try {
      for (const el of Array.from(root.querySelectorAll(selector))) {
        found.add(el);
      }
    } catch {
      // Invalid selector from a server pack — skip it.
    }
  }
  return [...found];
}

/**
 * Drop elements nested inside another element of the same set. A selector list
 * like `div[jsaction], a.hfpxzc` matches both a result card AND the anchor
 * inside it; without this every business is harvested twice, once from a node
 * that holds none of its detail rows.
 */
export function topLevelOnly(elements: Element[]): Element[] {
  return elements.filter(
    (el) => !elements.some((other) => other !== el && other.contains(el)),
  );
}

/** textContent of the first matching selector, cleaned. */
export function pickText(
  root: ParentElement,
  selectors: string[],
): string | null {
  const el = pick(root, selectors);
  return el ? cleanText(el.textContent) : null;
}

/** Cleaned text of every matching element (used for card info rows). */
export function pickAllText(root: ParentElement, selectors: string[]): string[] {
  return pickAll(root, selectors)
    .map((el) => cleanText(el.textContent))
    .filter((text): text is string => Boolean(text));
}

/** A named attribute of the first matching selector, cleaned. */
export function pickAttr(
  root: ParentElement,
  selectors: string[],
  attr: string,
): string | null {
  const el = pick(root, selectors);
  return el ? cleanText(el.getAttribute(attr)) : null;
}

/**
 * The first matching element's `aria-label`, else its text. Detail rows carry
 * their value in either one depending on locale and layout, so trying only one
 * is how a present field reads back as null.
 */
export function pickLabelOrText(
  root: ParentElement,
  selectors: string[],
): string | null {
  const el = pick(root, selectors);
  if (!el) return null;
  return cleanText(el.getAttribute("aria-label")) ?? cleanText(el.textContent);
}

/** Visible text of an element, line-cleaned and clipped. */
export function visibleText(el: Element | null, limit = 2000): string {
  if (!el) return "";
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return text
    .split("\n")
    .map((line) => cleanText(line))
    .filter((line): line is string => Boolean(line))
    .join("\n")
    .slice(0, limit);
}

/** Parse an integer count from "(1,234)" / "1,234 reviews". */
export function parseCount(value: string | null): number | null {
  return parseReviewCount(value);
}

/** Sleep for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until `predicate` is truthy or `timeout` ms elapse. */
export async function waitFor(
  predicate: () => boolean,
  timeout = 4000,
  interval = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(interval);
  }
  return predicate();
}
