// src/lib/sleeper/client.ts
//
// Single source of truth for all Sleeper API HTTP calls.
//
// Import `sleeperGet` (and `SLEEPER_BASE` if needed) everywhere instead of
// redefining `fetch` wrappers per-route. This centralises the base URL and
// ensures every request uses consistent caching headers.
//
// ── Sleeper's rules, from https://docs.sleeper.com ───────────────────────────
//
// Quoted rather than paraphrased: these are someone else's rules, and a reader
// should be able to check this file against them without leaving it.
//
//   • "Be mindful of the frequency of calls. A general rule is to stay under
//      1000 API calls per minute, otherwise, you risk being IP-blocked."
//   • On /players/nfl: "You do not need to call this endpoint more than once
//      per day" — it is roughly 5MB, and the docs ask that it be used sparingly.
//   • "No API Token is necessary, as you cannot modify contents via this API."
//     So nothing here sends credentials, and every call is a GET.
//
// The 1000/minute figure is the whole account's budget, not per endpoint — the
// player index carries its own, stricter rule on top of it. Every path this app
// calls is one the docs list; see SLEEPER_TTL for what each is allowed to cost.
//
// ── What actually reaches Sleeper ────────────────────────────────────────────
//
// Two layers sit in front of every call, and they cover different things. The
// division matters, because the second one exists to close a gap the first
// leaves open — measured against `next start` on Next 16.3.3, not assumed:
//
//   1. Next's Data Cache, via `next: { revalidate }`. Caching is opt-in in Next
//      15+ (a bare `fetch` is not cached at all), which is why every call here
//      passes a TTL. Within one route-handler invocation it collapses any number
//      of identical fetches into one, and it serves across invocations and
//      across users. It is stale-while-revalidate: past the TTL the stored body
//      is returned immediately and a refresh runs in the background.
//
//   2. The in-flight map below, which covers the case the Data Cache does not:
//      a *cold* miss. Its deduplication is per invocation, and route handlers
//      get no help from Next's request memoization either — that is documented
//      not to apply to them, since they are not part of the React component
//      tree. So with nothing stored yet, ten concurrent requests for one URL
//      each make their own call. Measured with ten parallel requests against an
//      empty cache: ten origin hits without this map, one with it. That is the
//      ordinary shape of a dashboard load on a freshly started process — several
//      panels asking about the same league at the same moment.
//
// What neither layer covers, stated plainly because it bounds the whole app:
// past the TTL the Data Cache serves stale and revalidates in the background,
// once per route-handler invocation, and that revalidation is issued inside
// Next below `sleeperGet` — the map cannot see it (measured: ten concurrent
// requests against a lapsed entry produced ten revalidations). So the ceiling is
// concurrent-requests-per-TTL per URL, and the only lever on it is the TTL. With
// the values below and three leagues that is roughly 40 calls/minute per URL at
// twenty simultaneous users, against Sleeper's 1000/minute — comfortable for a
// private league, and the number to revisit if this ever serves many at once.

/** Base URL for the Sleeper fantasy-sports API (v1). */
export const SLEEPER_BASE = 'https://api.sleeper.app/v1';

/** Identifies this app in Sleeper's logs. Sent on every call. */
export const SLEEPER_USER_AGENT = 'CommissionerSuite/1.0 (fantasy-league-manager)';

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
  /**
   * Trending adds/drops. Sleeper recomputes these on the order of an hour.
   *
   * The one call using this asks for `lookback_hours=168`, which is the top of
   * the documented range — a week of adds, which is the point of it here.
   */
  TRENDING: 600,
  /**
   * The full player index.
   *
   * The one endpoint with a rule of its own: at most one call per day, for a
   * ~5MB payload. Three layers hold to that — an in-process map, a DB row shared
   * by every instance, and this TTL — so a cold process reads the database
   * rather than Sleeper. See src/lib/sleeper/playerCache.ts.
   */
  PLAYERS: 86_400,
  /**
   * A Sleeper user's own profile — username, display name, avatar.
   *
   * Longer than LEAGUE because it is not the same kind of data. LEAGUE is short
   * so that a commissioner who renames a team sees it immediately; nobody
   * renames themselves and then checks this app to see whether it took. Every
   * signed-in user re-reads their own profile on each dashboard load, so this is
   * one of the highest-frequency calls in the app and the one where a longer
   * window costs nothing.
   */
  USER: 300,
  /** Bypass the cache. Only for an explicit user-triggered refresh. */
  FRESH: 0,
} as const;

/**
 * Identical requests currently in flight, keyed by URL and TTL.
 *
 * Holds the response *text* rather than the parsed body: concurrent callers each
 * parse their own copy, so one route mutating what it got back cannot be seen by
 * another that asked at the same moment. The entry is dropped as soon as the
 * request settles, so this only ever joins genuinely concurrent callers — it is
 * a stampede guard, not a second cache. Everything that outlives a request is
 * the Data Cache's job, and holding results here would silently override the TTL
 * the caller asked for.
 */
const inFlight = new Map<string, Promise<string>>();

/** Test seam — drops any coalesced request still recorded as in flight. */
export function clearInFlight(): void {
  inFlight.clear();
}

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
  // FRESH means "ask Sleeper now" — a sync, or a refresh button someone just
  // pressed. Joining it to an in-flight request would hand back an answer
  // fetched before they asked, which is the one thing FRESH exists to prevent.
  if (revalidate === SLEEPER_TTL.FRESH) return JSON.parse(await fetchText(path, revalidate)) as T;

  // Keyed on the TTL too: two callers asking for the same path with different
  // freshness are not asking the same question, and the Data Cache stores them
  // as separate entries.
  const key = `${revalidate}|${path}`;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetchText(path, revalidate);
    inFlight.set(key, pending);
    // Bookkeeping only. The `catch` is here so this chain cannot raise an
    // unhandled rejection of its own; the rejection still reaches every caller
    // through their own `await` below, which is what should happen — a failed
    // call shared by ten callers is one failure, not ten retries.
    void pending
      .catch(() => {})
      .finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); });
  }

  return JSON.parse(await pending) as T;
}

/** The fetch itself. Separated so the coalescing above reads as one decision. */
async function fetchText(path: string, revalidate: number): Promise<string> {
  const res = await fetch(`${SLEEPER_BASE}${path}`, {
    next: { revalidate },
    // Not required — the API takes no credentials — but it names us in Sleeper's
    // logs, which is what they would need to tell us we were being a nuisance
    // before resorting to the IP block the docs mention. The player-index call
    // has sent one for a while; this is every other call catching up.
    headers: { 'User-Agent': SLEEPER_USER_AGENT },
  });
  if (!res.ok) throw new Error(`Sleeper ${res.status}: ${path}`);
  return res.text();
}
