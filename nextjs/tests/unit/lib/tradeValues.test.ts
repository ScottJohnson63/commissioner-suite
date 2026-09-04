// tests/unit/lib/tradeValues.test.ts
//
// Covers src/lib/tradeValues.ts — pricing a roster when the stat table has no
// season totals for it.
//
// The case this exists for is a season not yet played, a sync that has not
// landed, or a cross-reference that found nothing. Season points are all zero
// there, which reads as "worth nothing" when it means "not known", and the two
// have to produce different trade advice.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/prisma', () => ({
  prisma: { nflWeeklyStat: { findMany: jest.fn() } },
}));

import { projectedValues, valueWindow, VALUE_WINDOW_WEEKS } from '@/lib/tradeValues';
import { clearWindowRowsCache } from '@/lib/formWindow';
import { prisma } from '@/lib/prisma';

const mockFindMany = prisma.nflWeeklyStat.findMany as jest.MockedFunction<
  typeof prisma.nflWeeklyStat.findMany
>;

const SCORING = { rec: 0.5 };

/** A week's row for one player, at the points the fixture wants. */
function row(playerId: string, position: string, week: number, fantasyPoints: number) {
  return { playerId, position, week, team: 'BUF', opponentTeam: 'MIA',
           fantasyPoints, receptions: 0 };
}

const xrefOf = (pairs: [string, string][]) => ({
  toGsis:    new Map(pairs.map(([sleeper, gsis]) => [sleeper, gsis])),
  toSleeper: new Map(pairs.map(([sleeper, gsis]) => [gsis, sleeper])),
  gsisIds:   pairs.map(([, gsis]) => gsis),
});

describe('valueWindow()', () => {
  // WHY: a fallback season's form is its *closing* weeks. Anchoring on the live
  //      week reads the opening of the wrong year — the bug the waiver panel
  //      already carries a note about.
  it('anchors a fallback season on its own final week', () => {
    expect(valueWindow({ season: 2025, maxWeek: 18, fallback: true }, 2)).toEqual({
      season: 2025, startWeek: 18 - (VALUE_WINDOW_WEEKS - 1), endWeek: 18, fallback: true,
    });
  });

  // WHY: a live season anchors on the last week with rows, which trails the last
  //      week played whenever the sync does.
  it('anchors a live season on the earlier of synced and played', () => {
    expect(valueWindow({ season: 2026, maxWeek: 9, fallback: false }, 11).endWeek).toBe(9);
    expect(valueWindow({ season: 2026, maxWeek: 12, fallback: false }, 11).endWeek).toBe(11);
  });

  it('never starts before week 1', () => {
    expect(valueWindow({ season: 2026, maxWeek: 2, fallback: false }, 2).startWeek).toBe(1);
  });
});

describe('projectedValues()', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    clearWindowRowsCache();
  });

  const window = { season: 2025, startWeek: 13, endWeek: 18, fallback: true };

  // WHY: the whole point of the fallback. A player with games of his own is
  //      projected from them, and the band says how firm that is.
  it('prices a player from his own recent form', async () => {
    mockFindMany.mockResolvedValue([
      row('g-rb1', 'RB', 14, 20), row('g-rb1', 'RB', 15, 22), row('g-rb1', 'RB', 16, 18),
      row('g-rb2', 'RB', 14, 8),  row('g-rb2', 'RB', 15, 6),  row('g-rb2', 'RB', 16, 10),
    ] as never);

    const values = await projectedValues(
      [{ playerId: 'rb-1', position: 'RB' }, { playerId: 'rb-2', position: 'RB' }],
      window, xrefOf([['rb-1', 'g-rb1'], ['rb-2', 'g-rb2']]), SCORING,
    );

    const one = values.get('rb-1')!;
    const two = values.get('rb-2')!;
    expect(one.games).toBe(3);
    // Blended toward the position baseline, so not exactly his own mean of 20 —
    // but well clear of the back averaging 8.
    expect(one.points).toBeGreaterThan(two.points);
    expect(one.floor).toBeLessThanOrEqual(one.points);
    expect(one.ceiling).toBeGreaterThanOrEqual(one.points);
    expect(one.floor).toBeGreaterThanOrEqual(0);
  });

  // WHY: the case that actually triggers the fallback — nothing at all for the
  //      rosters in question. A confident zero is the reading this module
  //      exists to avoid; the position's baseline is the honest one.
  it('prices a player with no games of his own at his position baseline', async () => {
    mockFindMany.mockResolvedValue([
      // A population of other players, none of them ours.
      row('g-a', 'TE', 14, 12), row('g-a', 'TE', 15, 14),
      row('g-b', 'TE', 14, 8),  row('g-b', 'TE', 15, 10),
      row('g-c', 'QB', 14, 24), row('g-c', 'QB', 15, 26),
    ] as never);

    const values = await projectedValues(
      [{ playerId: 'te-x', position: 'TE' }, { playerId: 'qb-x', position: 'QB' }],
      window, xrefOf([['te-x', 'g-te-x']]), SCORING,
    );

    const te = values.get('te-x')!;
    const qb = values.get('qb-x')!;
    expect(te.games).toBe(0);
    expect(te.points).toBeGreaterThan(0);
    // It cannot tell one tight end from another, but it knows a quarterback
    // outscores one — which is enough to price an unfilled slot.
    expect(qb.points).toBeGreaterThan(te.points);
    // No games of his own means a wide band, not a precise number.
    expect(te.ceiling).toBeGreaterThan(te.floor);
  });

  // WHY: with nothing in the window there is no baseline either, and inventing
  //      a number here would be the original bug with extra steps.
  it('returns nothing when the window is empty', async () => {
    mockFindMany.mockResolvedValue([] as never);

    const values = await projectedValues(
      [{ playerId: 'rb-1', position: 'RB' }], window, xrefOf([['rb-1', 'g-rb1']]), SCORING,
    );
    expect(values.size).toBe(0);
  });

  // WHY: a position the window has never seen — an unscored slot, a league with
  //      an exotic position — has no baseline to fall back to.
  it('omits a player whose position the window cannot speak for', async () => {
    mockFindMany.mockResolvedValue([
      row('g-a', 'QB', 14, 20), row('g-a', 'QB', 15, 22),
    ] as never);

    const values = await projectedValues(
      [{ playerId: 'k-x', position: 'K' }, { playerId: 'qb-x', position: 'QB' }],
      window, xrefOf([]), SCORING,
    );
    expect(values.has('k-x')).toBe(false);
    expect(values.has('qb-x')).toBe(true);
  });

  it('reads the window it is given, and only that window', async () => {
    mockFindMany.mockResolvedValue([row('g-a', 'QB', 14, 20)] as never);
    await projectedValues([{ playerId: 'qb-x', position: 'QB' }], window, xrefOf([]), SCORING);

    const where = (mockFindMany.mock.calls[0]?.[0] as
      { where: { season: number; week: { gte: number; lte: number } } }).where;
    expect(where.season).toBe(2025);
    expect(where.week).toEqual({ gte: 13, lte: 18 });
  });
});
