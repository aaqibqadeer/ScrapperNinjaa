/**
 * lib/format/datetime.ts — small, dependency-free date/time formatters.
 *
 * Pure helpers shared by any surface that renders a stored date (the Lead
 * Directory table, detail drawers, capture sessions, …) so a date is displayed
 * one consistent way. Every helper is null/invalid-safe: an unparseable or
 * empty value yields an empty string rather than "Invalid Date".
 */

/** Coerce an unknown stored value into a valid `Date`, or `null`. */
function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date only, in the viewer's locale (e.g. `8/3/2026`). */
export function formatDate(value: unknown): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString() : "";
}

/** Date + short time, in the viewer's locale (e.g. `8/3/2026, 1:49 AM`). */
export function formatDateTime(value: unknown): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
