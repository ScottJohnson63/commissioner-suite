// tests/unit/lib/cards/bonus.test.ts
//
// Covers the Sleeper bonus rules in src/lib/cards/bonus.ts.
//
// Sleeper reports each side of a matchup as its own row with a shared
// `matchup_id` and no winner field, so "did I win" has to be worked out — and
// the edges are where it goes wrong. A tie is not a win, a bye is not a win, and
// a roster with no entry scored nothing rather than crashing. Each of those is
// a pack wrongly granted or wrongly withheld.

import { describe, it, expect, jest } from '@jest/globals';

jest.mock('@/lib/prisma', () => ({
  prisma: { packBonus: {}, packGrant: {} },
}));

import {
  didRosterWin, rosterPoints, HIGH_SCORE_THRESHOLD, BONUS_KINDS,
} from '@/lib/cards/bonus';
import type { SleeperMatchupRaw } from '@/lib/sleeper/types';

const entry = (
  roster_id: number, matchup_id: number | null, points: number,
): SleeperMatchupRaw => ({ roster_id, matchup_id, points });

/** A week with a decisive game, a tie, and a bye. */
const WEEK: SleeperMatchupRaw[] = [
  entry(1, 1, 112.4),
  entry(2, 1, 98.2),
  entry(3, 2, 88.0),
  entry(4, 2, 88.0),
  entry(5, null, 101.0),
];

describe('didRosterWin()', () => {
  it('is true for the higher score in a pairing', () => {
    expect(didRosterWin(WEEK, 1)).toBe(true);
  });

  it('is false for the lower score', () => {
    expect(didRosterWin(WEEK, 2)).toBe(false);
  });

  // WHY: a tie is not a win. Using >= here would hand both managers a pack.
  it('is false for a tie', () => {
    expect(didRosterWin(WEEK, 3)).toBe(false);
    expect(didRosterWin(WEEK, 4)).toBe(false);
  });

  // WHY: Sleeper marks a bye with a null matchup_id. Nobody was beaten, so
  //      there is nothing to reward — and a high-scoring bye would otherwise
  //      look like a win against an empty opponent list.
  it('is false for a bye, however many points were scored', () => {
    expect(didRosterWin(WEEK, 5)).toBe(false);
  });

  it('is false for a roster with no entry that week', () => {
    expect(didRosterWin(WEEK, 99)).toBe(false);
  });

  it('is false for an empty week', () => {
    expect(didRosterWin([], 1)).toBe(false);
  });

  // WHY: a pairing with only one side present is a bye wearing a matchup_id.
  it('is false when the pairing has no opponent', () => {
    expect(didRosterWin([entry(1, 7, 150)], 1)).toBe(false);
  });

  // WHY: some Sleeper leagues run multi-team matchups. Beating one opponent but
  //      not another is not a win.
  it('requires beating every opponent in the pairing', () => {
    const threeWay = [entry(1, 1, 100), entry(2, 1, 90), entry(3, 1, 110)];
    expect(didRosterWin(threeWay, 1)).toBe(false);
    expect(didRosterWin(threeWay, 3)).toBe(true);
  });
});

describe('rosterPoints()', () => {
  it('reads the roster’s score', () => {
    expect(rosterPoints(WEEK, 1)).toBe(112.4);
  });

  // WHY: feeds the high-score comparison, so a missing entry must be 0 rather
  //      than undefined — `undefined > 100` is false but `undefined` in the
  //      stored `points` column would be a lie about what happened.
  it('is zero for a roster with no entry', () => {
    expect(rosterPoints(WEEK, 99)).toBe(0);
    expect(rosterPoints([], 1)).toBe(0);
  });
});

describe('the bonus rules', () => {
  it('has exactly two ways to earn a pack', () => {
    expect(BONUS_KINDS).toEqual(['WIN', 'HIGH_SCORE']);
  });

  // WHY: "over 100" is strict. Exactly 100 does not earn the pack.
  it('sets the high-score line at 100, exclusive', () => {
    expect(HIGH_SCORE_THRESHOLD).toBe(100);
    expect(rosterPoints(WEEK, 5) > HIGH_SCORE_THRESHOLD).toBe(true);   // 101
    expect(100 > HIGH_SCORE_THRESHOLD).toBe(false);
  });
});
