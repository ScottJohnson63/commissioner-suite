// src/lib/scoring.ts
//
// Turning a stat line into fantasy points, under one league's rules.
//
// NflWeeklyStat stores two pre-computed totals from nflverse: `fantasyPoints`
// (standard) and `fantasyPointsPpr` (full PPR). Reading either one directly is
// wrong here for three separate reasons:
//
//   1. Every league in this app scores rec=0.5. Full PPR values receptions at
//      double, which inflates receivers ~18-20% against quarterbacks — enough to
//      reorder a waiver list or tilt a trade.
//   2. nflverse leaves `fantasyPointsPpr` at 0 for every kicker, even though it
//      publishes the made/missed field goals by distance. Kickers scored zero.
//   3. nflverse publishes no team-defense rows at all under either column.
//
// So points are computed here, per league, from the component columns and the
// league's own `scoring_settings`. The three leagues do not agree — one splits
// field goals at 50-59 and 60+ where another stops at 50+ — so this cannot be
// baked into shared data at sync time.

import type { StatLine } from '@/types/scoring';

/**
 * The subset of Sleeper's `scoring_settings` this app reads.
 *
 * Sleeper omits a key entirely when its value is zero, so every field is
 * optional and every read defaults to 0. That default is correct: an absent key
 * really does mean the category scores nothing.
 */
export interface ScoringSettings {
  // ── Receiving ───────────────────────────────────────────────────────
  /** Points per reception. 1 = full PPR, 0.5 = half, absent = standard. */
  rec?: number;

  // ── Kicking: made field goals by distance ───────────────────────────
  fgm_0_19?:   number;
  fgm_20_29?:  number;
  fgm_30_39?:  number;
  fgm_40_49?:  number;
  fgm_50_59?:  number;
  /** Used by leagues that do not split 50-59 from 60+. */
  fgm_50p?:    number;
  fgm_60p?:    number;
  /** Flat per-make value, for leagues that ignore distance entirely. */
  fgm?:        number;

  // ── Kicking: misses and extra points ────────────────────────────────
  fgmiss_0_19?:  number;
  fgmiss_20_29?: number;
  fgmiss_30_39?: number;
  fgmiss_40_49?: number;
  fgmiss_50p?:   number;
  fgmiss?:       number;
  xpm?:          number;
  xpmiss?:       number;

  // ── Team defense ────────────────────────────────────────────────────
  sack?:      number;
  int?:       number;
  ff?:        number;
  fum_rec?:   number;
  def_td?:    number;
  def_st_td?: number;
  st_td?:     number;
  safe?:      number;
  blk_kick?:  number;

  pts_allow_0?:     number;
  pts_allow_1_6?:   number;
  pts_allow_7_13?:  number;
  pts_allow_14_20?: number;
  pts_allow_21_27?: number;
  pts_allow_28_34?: number;
  pts_allow_35p?:   number;

  yds_allow_0_100?:   number;
  yds_allow_100_199?: number;
  yds_allow_200_299?: number;
  yds_allow_300_349?: number;
  yds_allow_350_399?: number;
  yds_allow_400_449?: number;
  yds_allow_450_499?: number;
  yds_allow_500_549?: number;
  yds_allow_550p?:    number;
}

/**
 * The `select` every stat query needs to feed `scoreRow`.
 *
 * Shared so the three panels cannot drift into selecting different columns and
 * quietly scoring the same player differently. It is wider than the single
 * `fantasyPointsPpr` these routes used to read, but each column is a small
 * number and the row count is bounded by roster size.
 */
export const STAT_LINE_SELECT = {
  position:          true,
  fantasyPoints:     true,
  receptions:        true,

  fgMade:            true,
  fgMissed:          true,
  fgMade0To19:       true,
  fgMade20To29:      true,
  fgMade30To39:      true,
  fgMade40To49:      true,
  fgMade50To59:      true,
  fgMade60Plus:      true,
  fgMissed0To19:     true,
  fgMissed20To29:    true,
  fgMissed30To39:    true,
  fgMissed40To49:    true,
  fgMissed50To59:    true,
  fgMissed60Plus:    true,
  patMade:           true,
  patMissed:         true,

  defSacks:          true,
  defInterceptions:  true,
  defFumblesForced:  true,
  defFumbles:        true,
  defTds:            true,
  defSafeties:       true,
  defPuntBlocks:     true,
  defPatBlocks:      true,
  defFgBlocks:       true,
  pointsAllowed:     true,
  yardsAllowed:      true,
} as const;

/** Reads a setting, treating an absent key as the zero it stands for. */
function s(settings: ScoringSettings, key: keyof ScoringSettings): number {
  return settings[key] ?? 0;
}

/** Reads a stat column, treating null as zero. */
function n(value: number | null | undefined): number {
  return value ?? 0;
}

/**
 * Points for a skill-position player (QB/RB/WR/TE).
 *
 * Built from the stored standard total rather than re-deriving every category:
 * `fantasyPointsPpr` is exactly `fantasyPoints + receptions` in all 18,521 rows
 * of a season, so the reception rate is the only term that varies by league and
 * the rest of nflverse's arithmetic can be trusted as-is.
 */
export function scoreSkill(row: StatLine, settings: ScoringSettings): number {
  return n(row.fantasyPoints) + s(settings, 'rec') * n(row.receptions);
}

/**
 * Points for a kicker.
 *
 * Distance buckets are preferred. When they are absent — rows written before the
 * sync carried them — this falls back to valuing every make at the 30-39 rate,
 * which is the modal bucket, and says so via `exact: false` so a caller can
 * decide whether to show the number.
 */
export function scoreKicker(
  row: StatLine,
  settings: ScoringSettings,
): { points: number; exact: boolean } {
  const buckets: [number | null | undefined, keyof ScoringSettings][] = [
    [row.fgMade0To19,   'fgm_0_19'],
    [row.fgMade20To29,  'fgm_20_29'],
    [row.fgMade30To39,  'fgm_30_39'],
    [row.fgMade40To49,  'fgm_40_49'],
  ];

  const haveBuckets = buckets.some(([v]) => v != null)
    || row.fgMade50To59 != null
    || row.fgMade60Plus != null;

  const extraPoints =
    s(settings, 'xpm')    * n(row.patMade) +
    s(settings, 'xpmiss') * n(row.patMissed);

  if (!haveBuckets) {
    // No distance detail. A flat rate is the honest best guess; 30-39 is where
    // most kicks land, and `fgm` covers leagues that score distance-blind.
    const flat = s(settings, 'fgm') || s(settings, 'fgm_30_39');
    return {
      points: flat * n(row.fgMade) + s(settings, 'fgmiss') * n(row.fgMissed) + extraPoints,
      exact:  false,
    };
  }

  let points = extraPoints;
  for (const [made, key] of buckets) points += s(settings, key) * n(made);

  // A league either splits 50-59 from 60+ or lumps both into 50+. Whichever key
  // it defines is the one that applies to both buckets.
  const long50 = s(settings, 'fgm_50_59') || s(settings, 'fgm_50p');
  const long60 = s(settings, 'fgm_60p')   || s(settings, 'fgm_50p');
  points += long50 * n(row.fgMade50To59) + long60 * n(row.fgMade60Plus);

  points +=
    s(settings, 'fgmiss_0_19')  * n(row.fgMissed0To19)  +
    s(settings, 'fgmiss_20_29') * n(row.fgMissed20To29) +
    s(settings, 'fgmiss_30_39') * n(row.fgMissed30To39) +
    s(settings, 'fgmiss_40_49') * n(row.fgMissed40To49) +
    s(settings, 'fgmiss_50p')   * (n(row.fgMissed50To59) + n(row.fgMissed60Plus));

  return { points, exact: true };
}

/**
 * Scores a banded category — points allowed, yards allowed.
 *
 * `bands` are checked in order and the first whose ceiling the value fits under
 * wins; anything above the last one scores `above`. Taking the top band as an
 * explicit argument keeps a legitimate zero (a band the league does not define)
 * from being mistaken for "no band matched".
 */
function band(
  value: number,
  bands: [max: number, key: keyof ScoringSettings][],
  above: keyof ScoringSettings,
  settings: ScoringSettings,
): number {
  for (const [max, key] of bands) {
    if (value <= max) return s(settings, key);
  }
  return s(settings, above);
}

/**
 * Points for a team defense.
 *
 * Every category comes from the team's own row: the turnover and pressure
 * counts from nflverse's team stats, and points/yards allowed from the game
 * itself. Special-teams and defensive touchdowns are one stored count, scored at
 * whichever rate the league defines for them.
 */
export function scoreDefense(row: StatLine, settings: ScoringSettings): number {
  const touchdownRate =
    s(settings, 'def_td') || s(settings, 'def_st_td') || s(settings, 'st_td');

  const events =
    s(settings, 'sack')     * n(row.defSacks) +
    s(settings, 'int')      * n(row.defInterceptions) +
    s(settings, 'ff')       * n(row.defFumblesForced) +
    s(settings, 'fum_rec')  * n(row.defFumbles) +
    s(settings, 'safe')     * n(row.defSafeties) +
    s(settings, 'blk_kick') * (n(row.defPuntBlocks) + n(row.defPatBlocks) + n(row.defFgBlocks)) +
    touchdownRate           * n(row.defTds);

  // Points and yards allowed are only meaningful when the game is on record.
  // A null means the row predates the defense sync, not that a shutout happened.
  const pointsBand = row.pointsAllowed == null ? 0 : band(row.pointsAllowed, [
    [0,  'pts_allow_0'],
    [6,  'pts_allow_1_6'],
    [13, 'pts_allow_7_13'],
    [20, 'pts_allow_14_20'],
    [27, 'pts_allow_21_27'],
    [34, 'pts_allow_28_34'],
  ], 'pts_allow_35p', settings);

  const yardsBand = row.yardsAllowed == null ? 0 : band(row.yardsAllowed, [
    [99,  'yds_allow_0_100'],
    [199, 'yds_allow_100_199'],
    [299, 'yds_allow_200_299'],
    [349, 'yds_allow_300_349'],
    [399, 'yds_allow_350_399'],
    [449, 'yds_allow_400_449'],
    [499, 'yds_allow_450_499'],
    [549, 'yds_allow_500_549'],
  ], 'yds_allow_550p', settings);

  return events + pointsBand + yardsBand;
}

/**
 * Points for any stat line, dispatched on position.
 *
 * The single entry point every caller should use — a route that reaches for
 * `fantasyPointsPpr` directly is reading full PPR in a half-PPR league and
 * zero for every kicker.
 */
export function scoreRow(row: StatLine, settings: ScoringSettings): number {
  switch (row.position) {
    case 'K':   return scoreKicker(row, settings).points;
    case 'DEF': return scoreDefense(row, settings);
    default:    return scoreSkill(row, settings);
  }
}
