// src/lib/formWindow.ts
//
// "Every scored row in a stretch of weeks", loaded once and shared.
//
// Two different panels ask the same question of NflWeeklyStat: what did every
// player at a scored position do between week A and week B? The matchup report
// needs it for the positional baselines a thin-sample projection is blended
// with; the waiver panel needs it for the same baselines *and* for the
// defensive-strength ranks its context card shows. Each was loading a couple of
// thousand rows of its own, so it lives here and is cached by window.
//
// Deliberately not restricted to any one league's rosters: thirty players is
// too thin to say what a tight end typically scores, and the whole window is
// only a couple of thousand rows either way.

import { prisma } from '@/lib/prisma';
import { STAT_LINE_SELECT } from '@/lib/scoring';
import type { StatLine } from '@/types/scoring';
import { RouteCache } from '@/lib/cache';

/**
 * The window's whole population, carrying both readings' columns.
 *
 * `StatLine` is what scoring needs; the three join columns are what the
 * defensive-strength reading needs.
 */
export type WindowRow = StatLine & {
  playerId:     string;
  team:         string | null;
  opponentTeam: string | null;
  week:         number;
};

/** Positional baselines are the same rows for every request in a window. */
const windowCache = new RouteCache<WindowRow[]>();
const WINDOW_TTL = 5 * 60_000;

/** The positions worth a baseline. Everything else is unscored in fantasy. */
const SCORED_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * Loads every scored-position row between two weeks, inclusive.
 *
 * @param season   Stat season — the one `resolveStatsSeason` settled on, which
 *                 is not always the season being played.
 * @param fromWeek First week of the window, inclusive.
 * @param toWeek   Last week of the window, inclusive.
 */
export async function loadWindowRows(
  season: number,
  fromWeek: number,
  toWeek: number,
): Promise<WindowRow[]> {
  const key = `${season}-${fromWeek}-${toWeek}`;
  const hit = windowCache.get(key, WINDOW_TTL);
  if (hit) return hit;

  const rows = await prisma.nflWeeklyStat.findMany({
    where: {
      season,
      // Regular season only — see src/lib/statsSeason.ts on why postseason
      // weeks make a poor form window.
      seasonType: 'REG',
      week:       { gte: fromWeek, lte: toWeek },
      position:   { in: SCORED_POSITIONS },
    },
    // team, opponentTeam and week are for the defensive-strength reading; the
    // rest is what scoring a row needs.
    select: {
      playerId: true, team: true, opponentTeam: true, week: true,
      ...STAT_LINE_SELECT,
    },
  });
  windowCache.set(key, rows);
  return rows;
}

/** Test seam — the window outlives a single request by design. */
export function clearWindowRowsCache(): void {
  windowCache.clearAll();
}
