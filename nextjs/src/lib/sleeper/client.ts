// src/lib/sleeper/client.ts
//
// Single source of truth for all Sleeper API HTTP calls.
//
// Import `sleeperGet` (and `SLEEPER_BASE` if needed) everywhere instead of
// redefining `fetch` wrappers per-route. This centralises the base URL and
// ensures every request uses consistent caching headers.
//
// Sleeper rate-limit guidance (from their docs):
//   • General endpoints — no hard limit documented; be courteous.
//   • /players/nfl      — call at most once per 24 hours; the payload is large.
// The `revalidate` parameter feeds Next.js's built-in fetch cache so the same
// URL is not re-fetched within the specified interval, even across route calls.

/** Base URL for the Sleeper fantasy-sports API (v1). */
export const SLEEPER_BASE = 'https://api.sleeper.app/v1';

/**
 * Fetches a Sleeper API endpoint and returns the JSON-parsed response body.
 *
 * Throws an `Error` on any non-2xx HTTP status so callers can catch and
 * surface meaningful messages rather than silently swallowing empty data.
 *
 * @template T         Expected shape of the JSON response body.
 * @param path         Path relative to `SLEEPER_BASE`, e.g. `/league/123/rosters`.
 * @param revalidate   Next.js `fetch` cache TTL in seconds (default 300 = 5 min).
 *                     Set to `0` to bypass the cache for time-critical reads.
 * @returns            Parsed response body typed as `T`.
 * @throws             `Error` if the HTTP status is not 2xx.
 */
export async function sleeperGet<T>(path: string, revalidate = 300): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Sleeper ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}
