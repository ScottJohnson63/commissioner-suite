// src/lib/tradeValues.ts
//
// What a player is worth when the stat table has no totals for him.
//
// The trade finder prices everything on season points, which is the right
// number when the season has been played and no number at all when it has not.
// A roster of zeroes does not fail loudly: every player is worth nothing, every
// trade is a perfectly fair exchange of nothing, and the panel either fills with
// meaningless proposals or — after the finder learned to refuse them — goes
// blank. Neither is an answer a manager can use.
//
// So when the totals come back empty the finder falls back to the same
// projection the matchup report shows: the mean of the last six weeks blended
// toward what the player's position typically does, read as a band at roughly
// the 10th and 90th percentiles. See src/lib/projection.ts for the blend and
// why a thin sample has to be shrunk rather than reported as a certainty.
//
// The point of that blend is exactly this case. A player with no games of his
// own is not projected at zero; he is projected at his position's baseline,
// drawn from every player in the window rather than from the thirty on these
// two rosters. That is a weak reading and it is honestly weak — it cannot tell
// one running back from another, so it will not propose swapping them — but it
// knows a tight end is worth more than an empty tight end slot, which is enough
// to find the trades that fill a hole. Everything it produces is labelled as a
// projection on the way out, in points per game rather than points per season,
// because the two are not the same number and must never be shown as if they
// were.

import { buildBaselines, project } from '@/lib/projection';
import { loadWindowRows } from '@/lib/formWindow';
import { scoreRow } from '@/lib/scoring';
import type { ScoringSettings } from '@/lib/scoring';
import type { GsisXref } from '@/lib/sleeper/gsisXref';
import type { StatWindow } from '@/types/suggestions';

/** Weeks of form behind a projection — the matchup report's window. */
export const VALUE_WINDOW_WEEKS = 6;

/** Percentile the floor/ceiling band is read at — 1.28σ ≈ 10th/90th. */
const BAND_Z = 1.28;

/** Which of the two scales a set of player values is on. */
export type ValueBasis =
  /** Season totals, summed under the league's own rules. The default. */
  | 'season-points'
  /** Projected points per game, used when there are no totals to read. */
  | 'projected';

/** One player's price, and the range behind it. */
export interface PlayerValue {
  /** The figure the finder trades on: projected points per game. */
  points:  number;
  /** Roughly the 10th percentile of a single game. Clamped at zero. */
  floor:   number;
  /** Roughly the 90th percentile of a single game. */
  ceiling: number;
  /** Games actually observed. 0 means the number is entirely his position's. */
  games:   number;
}

/**
 * The stretch of weeks a projection should read, by the rule both other panels
 * already follow.
 *
 * A completed season's last weeks are its most recent form, so a fallback
 * season anchors on its final week. A live season anchors on the last week that
 * actually has rows, which trails the last week played whenever the sync does.
 * Anchoring a fallback on the live week instead reads the opening of the wrong
 * year — see the same note in the waiver route.
 */
export function valueWindow(
  stats:         { season: number; maxWeek: number; fallback: boolean },
  completedWeek: number,
): StatWindow {
  const lastSynced = stats.maxWeek > 0 ? stats.maxWeek : completedWeek;
  const endWeek    = stats.fallback ? lastSynced : Math.min(lastSynced, completedWeek);
  return {
    season:    stats.season,
    startWeek: Math.max(1, endWeek - (VALUE_WINDOW_WEEKS - 1)),
    endWeek,
    fallback:  stats.fallback,
  };
}

/**
 * Prices every given player from his recent form and his position's baseline.
 *
 * @param players  Rostered players, by Sleeper ID and position.
 * @param window   Weeks to read — from `valueWindow`.
 * @param xref     Sleeper ↔ GSIS translation; the stat table speaks GSIS.
 * @param scoring  The league's rules. The baseline has to be on the same scale
 *                 as the players blended against it.
 * @returns        Values by Sleeper ID. A player is absent only when nothing in
 *                 the window can speak for him or his position at all.
 */
export async function projectedValues(
  players: readonly { playerId: string; position: string }[],
  window:  StatWindow,
  xref:    GsisXref,
  scoring: ScoringSettings,
): Promise<Map<string, PlayerValue>> {
  const values = new Map<string, PlayerValue>();
  if (players.length === 0) return values;

  // The whole window, not just these rosters: thirty players is too thin to say
  // what a tight end typically scores. Shared and cached with the two panels
  // that already read it — see src/lib/formWindow.ts.
  const rows = await loadWindowRows(window.season, window.startWeek, window.endWeek);
  if (rows.length === 0) return values;

  const baselines = buildBaselines(rows, scoring);

  const observed = new Map<string, number[]>();
  for (const row of rows) {
    const sleeperId = xref.toSleeper.get(row.playerId);
    if (!sleeperId) continue;
    observed.set(sleeperId, [...(observed.get(sleeperId) ?? []), scoreRow(row, scoring)]);
  }

  for (const { playerId, position } of players) {
    const baseline = baselines.get(position);
    const games    = observed.get(playerId) ?? [];
    // Nothing observed and no baseline for the position: `project` would return
    // a confident zero, which is the reading this whole module exists to avoid.
    if (games.length === 0 && !baseline) continue;

    const { mean, sigma, games: n } = project(games, baseline);
    values.set(playerId, {
      points:  parseFloat(mean.toFixed(2)),
      floor:   parseFloat(Math.max(0, mean - BAND_Z * sigma).toFixed(1)),
      ceiling: parseFloat((mean + BAND_Z * sigma).toFixed(1)),
      games:   n,
    });
  }
  return values;
}
