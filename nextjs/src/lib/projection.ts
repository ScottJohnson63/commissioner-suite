// src/lib/projection.ts
//
// Turning a handful of weekly scores into a projection with an honest range.
//
// The naive version — take the mean, take the standard deviation, read a band at
// ±1.28σ — breaks down exactly where it matters most. `stdDev` returns 0 below
// two values, so a player with one game in the window got floor = ceiling =
// mean: presented as a certainty, and the most confident number on the panel
// belonged to the player we knew least about. A player with none got 0.0-0.0,
// which reads as "will not score" rather than "we have nothing".
//
// Both are the same mistake — treating absence of evidence as evidence — so both
// are fixed the same way. The estimate is blended with what the player's
// position typically does, weighted by how much was actually observed:
//
//     mean  = (n·observed + k·positional) / (n + k)
//     var   = (n·observed² + k·positional²) / (n + k)
//     sigma = sqrt(var · (1 + 1/(n + k)))
//
// `k` is the prior's weight in pseudo-games. At six observed games the player's
// own record dominates and this is within a rounding error of the old
// behaviour; at one game it is mostly the positional baseline, with a band wide
// enough to say so. The trailing (1 + 1/(n+k)) is the uncertainty in the mean
// itself, which is what stops a thin sample from ever looking precise.

import type { ScoringSettings } from '@/lib/scoring';
import { scoreRow } from '@/lib/scoring';
import type { StatLine } from '@/types/scoring';
import { stdDev } from '@/lib/math';

/**
 * Weight of the positional prior, in pseudo-games.
 *
 * Two is deliberately light. It is enough to stop a single game from being
 * reported as a certainty, and small enough that a player with a real record
 * still projects as himself: at n = 6 the prior carries a quarter of the
 * estimate, at n = 1 it carries two thirds.
 */
const PRIOR_GAMES = 2;

/**
 * Games a player needs in the window to join his position's baseline.
 *
 * Without it the baseline is dragged down by everyone who saw a single snap,
 * and the prior a thin-sample starter shrinks toward would describe a practice
 * squad rather than a lineup.
 */
const MIN_GAMES_FOR_BASELINE = 2;

/** What a position typically scores in the window being read. */
export interface PositionBaseline {
  mean:  number;
  sigma: number;
  /** Games behind the baseline. 0 when the position had none. */
  sample: number;
}

export interface Projection {
  /** Expected points. */
  mean:  number;
  /** Spread of a single future game, including uncertainty about the mean. */
  sigma: number;
  /** Games actually observed. 0 means the projection is entirely the prior. */
  games: number;
}

/** Mean of a non-empty list. */
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Builds a per-position baseline from every scored row in the window.
 *
 * @param rows     Stat lines for the window — all players, not just rostered.
 * @param scoring  The league's rules; the baseline has to be on the same scale
 *                 as the players it will be blended with.
 */
export function buildBaselines(
  rows: (StatLine & { playerId: string })[],
  scoring: ScoringSettings,
): Map<string, PositionBaseline> {
  // Points per player, so thin-sample players can be excluded by game count.
  const byPlayer = new Map<string, { position: string; points: number[] }>();
  for (const row of rows) {
    const position = row.position ?? '';
    if (!position) continue;
    const entry = byPlayer.get(row.playerId) ?? { position, points: [] };
    entry.points.push(scoreRow(row, scoring));
    byPlayer.set(row.playerId, entry);
  }

  const byPosition = new Map<string, number[]>();
  for (const { position, points } of byPlayer.values()) {
    if (points.length < MIN_GAMES_FOR_BASELINE) continue;
    byPosition.set(position, [...(byPosition.get(position) ?? []), ...points]);
  }

  const baselines = new Map<string, PositionBaseline>();
  for (const [position, points] of byPosition) {
    baselines.set(position, {
      mean:   mean(points),
      sigma:  stdDev(points),
      sample: points.length,
    });
  }
  return baselines;
}

/**
 * Projects a player from what was observed, backed by his position's baseline.
 *
 * @param observed  Scores from the window, in any order. May be empty.
 * @param baseline  The position's baseline, or undefined when there is none —
 *                  in which case this degrades to the plain mean and standard
 *                  deviation, the behaviour that existed before.
 */
export function project(
  observed: number[],
  baseline: PositionBaseline | undefined,
): Projection {
  const n = observed.length;

  if (!baseline || baseline.sample === 0) {
    return {
      mean:  n > 0 ? mean(observed) : 0,
      sigma: stdDev(observed),
      games: n,
    };
  }

  const k = PRIOR_GAMES;
  const observedMean = n > 0 ? mean(observed) : 0;
  const observedVar  = n > 0 ? stdDev(observed) ** 2 : 0;

  const blendedMean = (n * observedMean + k * baseline.mean) / (n + k);
  const blendedVar  = (n * observedVar  + k * baseline.sigma ** 2) / (n + k);

  // Spread of one future game, widened by how unsure the mean itself is.
  const sigma = Math.sqrt(blendedVar * (1 + 1 / (n + k)));

  return { mean: blendedMean, sigma, games: n };
}
