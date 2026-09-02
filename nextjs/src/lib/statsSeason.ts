// src/lib/statsSeason.ts
//
// "Which season of NflWeeklyStat should this request read?"
//
// The season a request is *about* (see resolveSeason in src/lib/sleeper/week.ts)
// and the season the stat table can actually answer for are not the same thing:
//
//   - Between the Sleeper rollover and kickoff, the new season exists on Sleeper
//     but has no games, so NflWeeklyStat holds nothing for it. Every form-based
//     panel would read zeros for weeks.
//   - In the opening weeks the new season has rows, but too few to say anything.
//     One game gives a mean of one number and a standard deviation of zero, so a
//     panel that switched over the moment week 1 landed would trade last year's
//     six-game form for a single result presented as a certainty.
//   - Mid-season the nflverse sync lags live play by a day or two, so the week
//     Sleeper reports is routinely ahead of the last week that has rows.
//
// All three are the same question — "how far does the data actually go?" — so
// they are answered here, once, rather than as special cases inside each route.

import { prisma } from '@/lib/prisma';

/** How far back to look for a season with data before giving up. */
const MAX_FALLBACK_SEASONS = 3;

/**
 * Weeks the live season must have before it is preferred over the last one.
 *
 * Four is the point where a mean and a spread start to describe a player rather
 * than a game. Below it the previous season's closing form is the better guide,
 * even though the new season technically has rows — a week-2 projection built on
 * week 1 alone gives every player a standard deviation of zero, which reads as
 * perfect confidence in a single result.
 *
 * The switch happens once, mid-season, and the panel captions which season it
 * used either way.
 */
const MIN_WEEKS_FOR_LIVE_SEASON = 4;

/** Cached per requested season; the answer only moves when a sync lands. */
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<number, { value: StatsSeason; ts: number }>();

export interface StatsSeason {
  /** The season to query NflWeeklyStat for. */
  season: number;
  /** Highest regular-season week with rows in `season`. 0 when there are none. */
  maxWeek: number;
  /** True when `season` is not the season that was asked for. */
  fallback: boolean;
}

/**
 * Resolves the season a stat query should actually read.
 *
 * Returns `requested` once it carries at least MIN_WEEKS_FOR_LIVE_SEASON weeks.
 * Before that — no rows at all, or only the opening week or two — it walks back
 * up to MAX_FALLBACK_SEASONS looking for the most recent season that does, so a
 * panel built on player form shows last season's closing numbers rather than a
 * column of zeros or a single game. When nothing is found, returns `requested`
 * with maxWeek 0 — callers treat that as "no stats", which is the truth.
 *
 * @param requested  The season the request is about, e.g. 2026.
 */
export async function resolveStatsSeason(requested: number): Promise<StatsSeason> {
  const hit = cache.get(requested);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  // The live season, which is the only one a threshold applies to: an earlier
  // season with any rows at all is already complete.
  const liveWeeks = await maxWeekOf(requested);
  if (liveWeeks >= MIN_WEEKS_FOR_LIVE_SEASON) {
    return cached(requested, { season: requested, maxWeek: liveWeeks, fallback: false });
  }

  // Too thin, or empty. Walk back for a season that can carry a full window.
  for (let offset = 1; offset <= MAX_FALLBACK_SEASONS; offset++) {
    const season  = requested - offset;
    const maxWeek = await maxWeekOf(season);
    if (maxWeek > 0) {
      return cached(requested, { season, maxWeek, fallback: true });
    }
  }

  // Nothing earlier to fall back to, so a thin live season beats no season —
  // reporting maxWeek 0 here would tell callers to expect nothing at all.
  const value: StatsSeason = liveWeeks > 0
    ? { season: requested, maxWeek: liveWeeks, fallback: false }
    : { season: requested, maxWeek: 0,         fallback: false };

  return cached(requested, value);
}

/** Memoises and returns one answer. */
function cached(requested: number, value: StatsSeason): StatsSeason {
  cache.set(requested, { value, ts: Date.now() });
  return value;
}

/**
 * Highest regular-season week with a row in the given season, or 0 if none.
 *
 * Postseason weeks (19–22) are excluded deliberately. They exist in the table
 * but cover only the players still playing — under 400 in week 19, under 70 by
 * week 22 — so anchoring a form window on week 22 of a completed season reads a
 * near-empty table and scores almost everyone at zero.
 */
async function maxWeekOf(season: number): Promise<number> {
  try {
    const row = await prisma.nflWeeklyStat.aggregate({
      where: { season, seasonType: 'REG' },
      _max:  { week: true },
    });
    return row._max.week ?? 0;
  } catch {
    // A stat table that cannot be read is the same as one with no rows: the
    // caller degrades to zeros rather than failing the whole panel.
    return 0;
  }
}

/** Test seam — drops the memoised answers. */
export function clearStatsSeasonCache(): void {
  cache.clear();
}
