// src/lib/sleeper/liveNames.ts
//
// Reading current names from Sleeper for rows the database only stores an old
// copy of.
//
// The League and Team tables each hold a `name` column written at sync time.
// Those columns are still needed — Team is the foreign key that Matchup points
// at, and a league has to be listable when Sleeper is unreachable — but they are
// no longer what the app *shows*. Anything user-facing resolves through here, so
// a rename in Sleeper appears on the next request rather than on the next sync.
//
// Every function in this module degrades rather than throws. A Sleeper outage
// must not take down the schedule page or empty the league list; falling back to
// the stored name shows slightly stale data, which is strictly better than an
// error page and is exactly what the app did before.

import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import { fetchRosterInfo } from '@/lib/sleeper/teams';
import type { SleeperLeagueRaw } from '@/lib/sleeper/types';

/**
 * Looks up a team's current name in Sleeper, keyed by the roster ID stored on
 * the Team row.
 *
 * Returns a function rather than a map so the fallback stays attached to the
 * lookup: callers pass the stored name alongside the roster ID and always get
 * something renderable back.
 *
 * @param sleeperLeagueId  League to read names from.
 * @param revalidate       Fetch TTL; defaults to the shared league window.
 * @returns  `(sleeperRosterId, storedName) => name`
 */
export async function teamNameResolver(
  sleeperLeagueId: string,
  revalidate: number = SLEEPER_TTL.LEAGUE,
): Promise<(sleeperRosterId: string, storedName: string) => string> {
  let live: Map<number, { name: string }>;
  try {
    live = await fetchRosterInfo(sleeperLeagueId, revalidate);
  } catch {
    // Sleeper unreachable — every lookup falls through to the stored name.
    return (_rosterId, storedName) => storedName;
  }

  return (sleeperRosterId, storedName) =>
    live.get(Number(sleeperRosterId))?.name || storedName;
}

/**
 * Current names for a set of leagues, keyed by Sleeper league ID.
 *
 * Leagues are fetched in parallel and failures are dropped rather than
 * propagated, so one deleted or unreachable league does not blank the rest of
 * the list. A missing entry means "no live answer" — the caller keeps whatever
 * it had stored.
 */
export async function fetchLeagueNames(
  sleeperLeagueIds: string[],
  revalidate: number = SLEEPER_TTL.LEAGUE,
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    sleeperLeagueIds.map(async (id): Promise<[string, string] | null> => {
      try {
        const league = await sleeperGet<SleeperLeagueRaw>(`/league/${id}`, revalidate);
        return league?.name ? [id, league.name] : null;
      } catch {
        return null;
      }
    }),
  );

  return new Map(entries.filter((e): e is [string, string] => e !== null));
}
