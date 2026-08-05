/**
 * app/robots.ts — generates /robots.txt (Next.js Metadata API, Phase 9).
 *
 * Allows the public site, disallows authenticated/admin/API surfaces, and points
 * crawlers at the sitemap. The host is `NEXT_PUBLIC_APP_URL` (validated env).
 */

import type { MetadataRoute } from "next";

import { env } from "@/config/env.schema";

/** Route prefixes crawlers shouldn't index (auth-gated or non-content). */
const DISALLOW = [
  "/api/",
  "/admin",
  "/leads",
  "/settings",
  "/invite",
];

export default function robots(): MetadataRoute.Robots {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: DISALLOW,
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
