/**
 * lib/auth/constants.ts — cookie names, token purposes, and TTLs shared across
 * the auth layer. Edge-safe (no Node-only imports).
 */

/** httpOnly session cookie set by the custom (MongoDB) JWT flow. */
export const SESSION_COOKIE = "ninjakit_session";

/** OAuth CSRF state cookie (custom flow). */
export const OAUTH_STATE_COOKIE = "ninjakit_oauth_state";

/**
 * Selects the active organization for a session (multi-tenant workspace
 * switcher). Not httpOnly-sensitive — it only holds an org id that the server
 * re-validates against the user's memberships on every read (see
 * `resolveActiveOrgContext`). Cleared/ignored when it doesn't match a membership.
 */
export const ACTIVE_ORG_COOKIE = "ninjakit_active_org";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const MAGIC_LINK_TTL_SECONDS = 60 * 15; // 15 minutes
export const EMAIL_VERIFY_TTL_SECONDS = 60 * 60 * 24; // 24 hours
/** Long-lived bearer token held by the Chrome extension (chrome.storage). */
export const EXTENSION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Signed-token purposes so a token minted for one flow can't be used in another. */
export const TOKEN_PURPOSE = {
  session: "session",
  passwordReset: "password_reset",
  magicLink: "magic_link",
  emailVerify: "email_verify",
  extension: "extension",
} as const;
export type TokenPurpose = (typeof TOKEN_PURPOSE)[keyof typeof TOKEN_PURPOSE];

/** Default post-login destination and the login route middleware redirects to. */
export const LOGIN_PATH = "/login";
/** Post-login landing — Lead Directory home. */
export const DEFAULT_AUTHED_PATH = "/leads";

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_MAX_AGE_SECONDS,
};
