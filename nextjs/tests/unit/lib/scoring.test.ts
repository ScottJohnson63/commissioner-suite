// tests/unit/lib/scoring.test.ts
//
// Covers src/lib/scoring.ts — turning a stat line into points under one league's
// rules.
//
// This exists because reading nflverse's pre-computed columns was wrong three
// separate ways: full PPR in half-PPR leagues, zero for every kicker, and no
// defense rows at all. Each of those is pinned below with the real values from
// the leagues in this deployment.

import { describe, it, expect } from '@jest/globals';
import {
  scoreSkill, scoreKicker, scoreDefense, scoreRow, type ScoringSettings,
} from '@/lib/scoring';
import type { StatLine } from '@/types/scoring';

/** The scoring these leagues actually use: half PPR, field goals by distance. */
const LEAGUE: ScoringSettings = {
  rec: 0.5,
  fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5, fgm_60p: 6,
  xpm: 1, xpmiss: -1,
  fgmiss_0_19: -1, fgmiss_20_29: -1, fgmiss_30_39: -1,
  sack: 1, int: 2, ff: 1, fum_rec: 2, def_td: 6, safe: 2, blk_kick: 2,
  pts_allow_0: 12, pts_allow_1_6: 8, pts_allow_7_13: 6, pts_allow_14_20: 4,
  pts_allow_21_27: 3, pts_allow_28_34: -1, pts_allow_35p: -5,
  yds_allow_0_100: 3, yds_allow_100_199: 2,
  yds_allow_450_499: -1, yds_allow_500_549: -2, yds_allow_550p: -3,
};

function line(over: Partial<StatLine> = {}): StatLine {
  return { position: 'WR', fantasyPoints: 0, receptions: 0, ...over };
}

describe('scoreSkill()', () => {
  // WHY: the bug this module was written for. Every league here scores rec=0.5,
  //      and the panels were reading the full-PPR column — receivers came out
  //      ~18-20% high against quarterbacks, enough to reorder a waiver list.
  it('values receptions at the league rate, not full PPR', () => {
    const row = line({ fantasyPoints: 10, receptions: 8 });
    expect(scoreSkill(row, LEAGUE)).toBe(14);              // 10 + 8 × 0.5
    expect(scoreSkill(row, { rec: 1 })).toBe(18);          // full PPR
    expect(scoreSkill(row, {})).toBe(10);                  // standard
  });

  // WHY: nflverse's own full-PPR column is exactly standard + receptions across
  //      every row of a season, which is what makes deriving any rec rate from
  //      the standard total exact rather than approximate.
  it('reproduces the stored full-PPR total at rec = 1', () => {
    const row = line({ fantasyPoints: 12.4, receptions: 6 });
    expect(scoreSkill(row, { rec: 1 })).toBeCloseTo(18.4, 5);
  });

  it('treats missing counts as zero', () => {
    expect(scoreSkill(line({ fantasyPoints: null, receptions: null }), LEAGUE)).toBe(0);
  });
});

describe('scoreKicker()', () => {
  // WHY: kickers scored 0.0 in every panel. nflverse leaves fantasyPointsPpr at
  //      zero for them — max 0.6 across 543 rows in 2025 — while publishing the
  //      made kicks by distance that the league actually scores.
  it('scores made field goals by distance', () => {
    // Nick Folk, 2025 week 1: one 30-39, one 50-59, two extra points.
    const row = line({
      position: 'K', fgMade: 2, fgMade30To39: 1, fgMade50To59: 1, patMade: 2,
    });
    const { points, exact } = scoreKicker(row, LEAGUE);
    expect(points).toBe(10);   // 3 + 5 + 2
    expect(exact).toBe(true);
  });

  it('charges for misses inside 40 and for missed extra points', () => {
    const row = line({
      position: 'K', fgMade40To49: 1, fgMissed0To19: 1, fgMissed30To39: 1,
      patMade: 1, patMissed: 1,
    });
    expect(scoreKicker(row, LEAGUE).points).toBe(2);   // 4 - 1 - 1 + 1 - 1
  });

  // WHY: leagues disagree here. Two of the three split 50-59 from 60+; the third
  //      stops at 50+, and its single key has to cover both buckets.
  it('applies a 50+ tier to both long buckets when a league does not split them', () => {
    const row = line({ position: 'K', fgMade50To59: 1, fgMade60Plus: 1 });
    expect(scoreKicker(row, { fgm_50p: 5 }).points).toBe(10);
    expect(scoreKicker(row, LEAGUE).points).toBe(11);   // 5 + 6, split tiers
  });

  // WHY: rows written before the sync carried the distance columns have only a
  //      total. A flat rate is the honest reading, and `exact: false` lets a
  //      caller say so rather than presenting a guess as a measurement.
  it('falls back to a flat rate when the distance buckets are absent', () => {
    const row = line({ position: 'K', fgMade: 3, patMade: 2 });
    const { points, exact } = scoreKicker(row, LEAGUE);
    expect(points).toBe(11);   // 3 × 3 + 2
    expect(exact).toBe(false);
  });

  it('prefers an explicit distance-blind rate over the 30-39 tier', () => {
    const row = line({ position: 'K', fgMade: 2 });
    expect(scoreKicker(row, { fgm: 4, fgm_30_39: 3 }).points).toBe(8);
  });
});

describe('scoreDefense()', () => {
  // WHY: the Ravens' 2025 week 15 shutout of Cincinnati — the case where every
  //      category fires at once, and the one worth pinning exactly.
  it('scores a real defensive week', () => {
    const row = line({
      position: 'DEF',
      defSacks: 3, defInterceptions: 2, defTds: 1,
      pointsAllowed: 0, yardsAllowed: 325,
    });
    // 3 sacks + 2 INT (4) + TD (6) + shutout (12) = 25. 325 yards scores nothing.
    expect(scoreDefense(row, LEAGUE)).toBe(25);
  });

  it('scores the points-allowed band the total falls in', () => {
    const at = (pointsAllowed: number) =>
      scoreDefense(line({ position: 'DEF', pointsAllowed }), LEAGUE);
    expect(at(0)).toBe(12);
    expect(at(6)).toBe(8);
    expect(at(13)).toBe(6);
    expect(at(20)).toBe(4);
    expect(at(27)).toBe(3);
    expect(at(34)).toBe(-1);
    expect(at(35)).toBe(-5);
    expect(at(52)).toBe(-5);   // anything above the last band
  });

  // WHY: a band a league does not define scores nothing, and that legitimate
  //      zero must not be mistaken for "no band matched" and fall through to the
  //      penalty at the top.
  it('scores an undefined middle band as zero, not as the top band', () => {
    expect(scoreDefense(line({ position: 'DEF', pointsAllowed: 25 }), {
      pts_allow_0: 12, pts_allow_35p: -5,
    })).toBe(0);
  });

  // WHY: null means the defense sync has not written this row, not that the
  //      opponent was held scoreless — which would silently award 12 points.
  it('scores nothing for points allowed when the game is not on record', () => {
    expect(scoreDefense(line({ position: 'DEF', pointsAllowed: null }), LEAGUE)).toBe(0);
  });

  it('scores yards allowed at both ends of the range', () => {
    const at = (yardsAllowed: number) =>
      scoreDefense(line({ position: 'DEF', yardsAllowed }), LEAGUE);
    expect(at(80)).toBe(3);
    expect(at(150)).toBe(2);
    expect(at(342)).toBe(0);    // the league-average game scores nothing
    expect(at(470)).toBe(-1);
    expect(at(600)).toBe(-3);
  });

  it('counts every kind of blocked kick at the same rate', () => {
    const row = line({
      position: 'DEF', defPuntBlocks: 1, defPatBlocks: 1, defFgBlocks: 1,
    });
    expect(scoreDefense(row, LEAGUE)).toBe(6);
  });
});

describe('scoreRow()', () => {
  it('dispatches on position', () => {
    expect(scoreRow(line({ position: 'K', fgMade40To49: 1 }), LEAGUE)).toBe(4);
    expect(scoreRow(line({ position: 'DEF', defSacks: 2 }), LEAGUE)).toBe(2);
    expect(scoreRow(line({ position: 'WR', fantasyPoints: 6, receptions: 4 }), LEAGUE)).toBe(8);
  });

  // WHY: a Sleeper outage leaves the settings empty. Every read defaults to 0,
  //      so the panel shows visibly low numbers rather than failing the request.
  it('degrades to zero-valued categories when settings are empty', () => {
    expect(scoreRow(line({ position: 'K', fgMade40To49: 3 }), {})).toBe(0);
    expect(scoreRow(line({ position: 'WR', fantasyPoints: 9, receptions: 5 }), {})).toBe(9);
  });

  it('treats an unknown position as a skill player', () => {
    expect(scoreRow(line({ position: null, fantasyPoints: 5, receptions: 2 }), LEAGUE)).toBe(6);
  });
});
