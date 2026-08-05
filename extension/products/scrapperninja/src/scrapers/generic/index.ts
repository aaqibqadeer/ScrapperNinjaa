/**
 * Generic directory adapter — tier "b", no deep capture.
 *
 * No per-site selectors. It heuristically finds the repeated result block on a
 * page — the largest set of structurally-similar sibling elements — strips each
 * to clean text, and emits a RawRecord carrying only `rawSnippet` plus
 * `parseIssues: ["needs_ai_extract"]`. The server (POST /api/scrape/extract /
 * the ingest rescue path) turns those snippets into structured fields with
 * DeepSeek. This is what makes Yellow Pages, BBB, Manta, Hotfrog, chamber
 * directories, Avvo, Angi, etc. work with zero new code.
 */

import { cleanText, sleep } from "../dom";
import { readPageMeta } from "../page-meta";
import type { HarvestContext, RawRecord, SourceAdapter } from "../types";

/** A coarse structural signature so siblings of the same "kind" group together. */
function signature(el: Element): string {
  const tag = el.tagName;
  const childTags = Array.from(el.children)
    .map((c) => c.tagName)
    .slice(0, 8)
    .join(",");
  // Bucket text length so cards with slightly different copy still match.
  const textBucket = Math.min(6, Math.floor((el.textContent?.length ?? 0) / 60));
  return `${tag}|${childTags}|${textBucket}`;
}

/** True for elements that plausibly represent a business row (has some text). */
function looksMeaningful(el: Element): boolean {
  const text = el.textContent ?? "";
  if (text.trim().length < 20) return false;
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  if (rect && (rect.width === 0 || rect.height === 0)) return false;
  return true;
}

/**
 * Find the repeated result block: scan every element with several children,
 * group its direct children by structural signature, and keep the largest
 * group (>= 3 similar, meaningful siblings). Ties break toward more members.
 */
export function detectRepeatedBlocks(root: BlockRoot = document): Element[] {
  let best: Element[] = [];
  const containers = root.querySelectorAll("*");
  for (const container of Array.from(containers)) {
    const children = Array.from(container.children);
    if (children.length < 3) continue;
    const groups = new Map<string, Element[]>();
    for (const child of children) {
      if (!looksMeaningful(child)) continue;
      const key = signature(child);
      const group = groups.get(key);
      if (group) group.push(child);
      else groups.set(key, [child]);
    }
    for (const group of groups.values()) {
      if (group.length >= 3 && group.length > best.length) best = group;
    }
  }
  return best;
}

/** Strip a block to clean, newline-separated visible text. */
function blockText(el: Element): string {
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return text
    .split("\n")
    .map((line) => cleanText(line))
    .filter((line): line is string => Boolean(line))
    .join("\n")
    .slice(0, 2000);
}

export const genericAdapter: SourceAdapter = {
  id: "generic_web",
  automationTier: "b",
  supportsDeep: false,

  match(): boolean {
    // Registry fallback — claims any URL not matched by a more specific adapter.
    return true;
  },

  async harvestList(ctx: HarvestContext): Promise<RawRecord[]> {
    const blocks = detectRepeatedBlocks(document);
    return blocks.map((block, index) => ({
      rawSnippet: blockText(block),
      parseIssues: ["needs_ai_extract"],
      sourceUrl: ctx.sourceUrl,
      ref: `block:${index}`,
    }));
  },

  async capturePage(ctx: HarvestContext): Promise<RawRecord> {
    // A single-page capture is a business page, not a result list: read the
    // metadata the page publishes about itself before falling back to AI.
    const meta = readPageMeta(ctx.sourceUrl || location.href);
    const main =
      document.querySelector("main") ?? document.body ?? document.documentElement;
    return {
      businessName: meta.businessName,
      category: meta.category,
      description: meta.description,
      phone: meta.phone,
      website: meta.website,
      emails: meta.emails,
      socials: meta.socials,
      ownerName: meta.ownerName,
      address: meta.address ?? undefined,
      lat: meta.lat,
      lng: meta.lng,
      rawSnippet: blockText(main),
      parseIssues: ["needs_ai_extract"],
      sourceUrl: ctx.sourceUrl,
      ref: location.href,
    };
  },

  async scroll(): Promise<{ reachedEnd: boolean }> {
    const before = document.documentElement.scrollHeight;
    window.scrollTo({ top: document.documentElement.scrollHeight });
    await sleep(1000);
    return { reachedEnd: document.documentElement.scrollHeight === before };
  },
};

type BlockRoot = Document | Element;
