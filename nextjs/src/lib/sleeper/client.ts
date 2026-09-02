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
 * Cache lifetimes, in seconds, keyed by how fast the underlying data moves.
 * Every Sleeper call should pick one of these rather than an inline number, so
 * the request rate against Sleeper stays reviewable in one place.
 *
 * The governing rule: if a manager can change it in the Sleeper app and would
 * reasonably expect to see it here straight away, it belongs in LEAGUE. Sleeper
 * is pull-only — there are no webhooks — so "immediately" can only ever mean
 * "on the next request, with a window short enough that nobody notices". LEAGUE
 * is that window.
 */
export const SLEEPER_TTL = {
  /** Current season/week pointer. Short, so a week rollover is picked up fast. */
  NFL_STATE: 60,
  /**
   * League name, team names, rosters, settings, matchups — everything a manager
   * or commissioner edits in Sleeper and expects to see reflected in the app.
   *
   * Deliberately short. This was 300s, which meant a renamed team could show the
   * old name for five minutes on one screen while another screen had already
   * moved on. Thirty seconds reads as instant to a person clicking between
   * pages, and still collapses a burst of requests into a single Sleeper call.
   */
  LEAGUE: 30,
  /** Trending adds/drops. Sleeper recomputes these on the order of an hour. */
  TRENDING: 600,
  /** The full player index. Sleeper asks for at most one call per 24 hours. */
  PLAYERS: 86_400,
  /** Bypass the cache. Only for an explicit user-triggered refresh. */
  FRESH: 0,
} as const;

/**
 * Fetches a Sleeper API endpoint and returns the JSON-parsed response body.
 *
 * Throws an `Error` on any non-2xx HTTP status so callers can catch and
 * surface meaningful messages rather than silently swallowing empty data.
 *
 * @template T         Expected shape of the JSON response body.
 * @param path         Path relative to `SLEEPER_BASE`, e.g. `/league/123/rosters`.
 * @param revalidate   Next.js `fetch` cache TTL in seconds. Pick a `SLEEPER_TTL`
 *                     member rather than passing a bare number.
 * @returns            Parsed response body typed as `T`.
 * @throws             `Error` if the HTTP status is not 2xx.
 */
export async function sleeperGet<T>(
  path: string,
  revalidate: number = SLEEPER_TTL.LEAGUE,
): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Sleeper ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}
