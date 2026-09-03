// src/lib/sleeper/lineup.ts
//
// How many players a league actually starts at each position.
//
// This exists for the waiver panel's "weak spots" test, which used to compare
// each roster's single best player at a position against the league median of
// the same. That is the right question for QB and TE and the wrong one for RB
// and WR: a league that starts two of each is not described by its best one, so
// a team with an elite RB1 and nothing behind him read as strong at running
// back while it started a replacement-level RB2 every week.
//
// Read from the same `/league/{id}` payload the scoring settings come from, so
// it costs no extra Sleeper call — `sleeperGet` caches the response.

import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import { RouteCache } from '@/lib/cache';

/**
 * Lineups change at most once a season, and only by a commissioner editing
 * them, so this is cached far longer than league state.
 */
const SLOTS_TTL = 60 * 60 * 1000; // 1 hour

const cache = new RouteCache<Record<string, number>>();

/**
 * Sleeper's league payload, narrowed to the part this module reads.
 *
 * `roster_positions` is the lineup as an array of slot labels, one entry per
 * slot: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", ...].
 */
interface LeagueWithLineup {
  roster_positions?: string[] | null;
}

/**
 * The standard Sleeper lineup, used when the league cannot be read.
 *
 * A failed fetch should not silently collapse every position to a
 * one-player comparison, which is the shape of the bug this module fixes.
 */
export const DEFAULT_STARTER_SLOTS: Record<string, number> = {
  QB: 1, RB: 2, WR: 2, TE: 1, K: 1,
};

/**
 * Starting slots per position for a league.
 *
 * Only explicitly named slots are counted. FLEX, SUPER_FLEX and the rest are
 * deliberately left out rather than distributed: a flex slot is not owed to any
 * one position, and adding it to every eligible one would claim a league starts
 * four running backs when it starts two and a choice. The depth question a flex
 * raises is already answered by the explicit slots either side of it.
 *
 * Bench, IR and taxi entries are not lineup slots and are skipped the same way.
 *
 * @param leagueId  Sleeper league ID.
 * @returns         Position → slot count. Never empty: a league whose payload
 *                  carries no lineup falls back to DEFAULT_STARTER_SLOTS.
 */
export async function getStarterSlots(leagueId: string): Promise<Record<string, number>> {
  const hit = cache.get(leagueId, SLOTS_TTL);
  if (hit) return hit;

  try {
    const league = await sleeperGet<LeagueWithLineup>(
      `/league/${leagueId}`,
      SLEEPER_TTL.LEAGUE,
    );

    const slots: Record<string, number> = {};
    for (const slot of league?.roster_positions ?? []) {
      // Anything that is not a bare position — FLEX, SUPER_FLEX, BN, IR, TAXI —
      // is not a slot this can attribute to a position. See above.
      if (!/^(QB|RB|WR|TE|K|DEF)$/.test(slot)) continue;
      slots[slot] = (slots[slot] ?? 0) + 1;
    }

    const result = Object.keys(slots).length > 0 ? slots : { ...DEFAULT_STARTER_SLOTS };
    cache.set(leagueId, result);
    return result;
  } catch {
    // Same reasoning as getScoringSettings: degrade to a sensible lineup rather
    // than failing the whole panel. Deliberately not cached — a transient
    // Sleeper failure should not pin the default for an hour.
    return { ...DEFAULT_STARTER_SLOTS };
  }
}

/** Test seam — drops every cached league's lineup. */
export function clearStarterSlotsCache(): void {
  cache.clearAll();
}
