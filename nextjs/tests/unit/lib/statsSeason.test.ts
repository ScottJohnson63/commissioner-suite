// tests/unit/lib/statsSeason.test.ts
//
// Covers src/lib/statsSeason.ts — deciding which season of NflWeeklyStat a
// request can actually be answered from.
//
// This exists because the season Sleeper reports and the season the stat table
// holds rows for come apart twice a year: between the Sleeper rollover and
// kickoff (no rows at all for the new season) and mid-season whenever the
// nflverse sync trails live play (rows, but not through the current week).
// Without the fallback the panels built on player form read a column of zeros.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/prisma', () => ({
  prisma: { nflWeeklyStat: { aggregate: jest.fn() } },
}));

import { resolveStatsSeason, clearStatsSeasonCache } from '@/lib/statsSeason';
import { prisma } from '@/lib/prisma';

const mockAggregate = prisma.nflWeeklyStat.aggregate as jest.MockedFunction<
  typeof prisma.nflWeeklyStat.aggregate
>;

/** Answers `aggregate` from a season → maxWeek table; seasons absent have no rows. */
function seasonsWithData(table: Record<number, number>): void {
  mockAggregate.mockImplementation((async (args: { where: { season: number } }) => ({
    _max: { week: table[args.where.season] ?? null },
  })) as never);
}

describe('resolveStatsSeason()', () => {
  beforeEach(() => {
    mockAggregate.mockReset();
    clearStatsSeasonCache();
  });

  it('uses the requested season when it has rows', async () => {
    seasonsWithData({ 2026: 7 });
    expect(await resolveStatsSeason(2026)).toEqual({
      season: 2026, maxWeek: 7, fallback: false,
    });
  });

  // WHY: the opening weeks of a season have rows but not enough of them. One
  //      game gives a mean of one number and a standard deviation of zero, so
  //      switching over the moment week 1 lands trades six games of last
  //      season's form for a single result shown as a certainty.
  it.each([1, 2, 3])('holds the previous season through week %i', async (week) => {
    seasonsWithData({ 2026: week, 2025: 18 });
    expect(await resolveStatsSeason(2026)).toEqual({
      season: 2025, maxWeek: 18, fallback: true,
    });
  });

  // WHY: four weeks is where a mean and a spread start describing a player
  //      rather than a game. The switch happens once and does not flap.
  it('switches to the live season at four weeks', async () => {
    seasonsWithData({ 2026: 4, 2025: 18 });
    expect(await resolveStatsSeason(2026)).toEqual({
      season: 2026, maxWeek: 4, fallback: false,
    });
  });

  // WHY: the threshold must not strand a request when there is no earlier season
  //      to fall back to — two weeks of data still beats none, and reporting
  //      maxWeek 0 there would tell callers to expect nothing at all.
  it('takes a thin live season when nothing earlier has rows', async () => {
    seasonsWithData({ 2026: 2 });
    expect(await resolveStatsSeason(2026)).toEqual({
      season: 2026, maxWeek: 2, fallback: false,
    });
  });

  // WHY: this is the pre-kickoff case. Sleeper has already rolled over to the new
  //      season, but no game has been played, so the only real numbers available
  //      are last season's.
  it('falls back to the most recent season that has rows', async () => {
    seasonsWithData({ 2025: 18 });
    expect(await resolveStatsSeason(2026)).toEqual({
      season: 2025, maxWeek: 18, fallback: true,
    });
  });

  it('keeps walking back past a season that is also empty', async () => {
    seasonsWithData({ 2024: 18 });
    expect(await resolveStatsSeason(2026)).toEqual({
      season: 2024, maxWeek: 18, fallback: true,
    });
  });

  // WHY: postseason weeks exist in the table but cover a shrinking subset of
  //      players — under 400 in week 19, under 70 by week 22. Anchoring a form
  //      window on week 22 reads a near-empty table and scores almost everyone
  //      at zero, which is what made the pre-kickoff fallback look broken.
  it('asks only about regular-season rows', async () => {
    seasonsWithData({ 2026: 6 });
    await resolveStatsSeason(2026);
    expect((mockAggregate.mock.calls[0]?.[0] as { where: { seasonType: string } }).where.seasonType)
      .toBe('REG');
  });

  // WHY: an empty stat table is a real state (a fresh deployment), and "no stats"
  //      is the honest answer. Callers read maxWeek 0 as "don't clamp, expect
  //      nothing" rather than failing the request.
  it('reports the requested season with no weeks when nothing has rows', async () => {
    seasonsWithData({});
    expect(await resolveStatsSeason(2026)).toEqual({
      season: 2026, maxWeek: 0, fallback: false,
    });
  });

  // WHY: the search is bounded so a misconfigured NFL_SEASON cannot turn one
  //      request into an unbounded walk backwards through the table.
  it('gives up after three seasons rather than searching indefinitely', async () => {
    seasonsWithData({ 2020: 18 });
    const result = await resolveStatsSeason(2026);
    expect(result).toEqual({ season: 2026, maxWeek: 0, fallback: false });
    expect(mockAggregate).toHaveBeenCalledTimes(4); // 2026, 2025, 2024, 2023
  });

  // WHY: a stat table that cannot be read should degrade to zeros in one panel,
  //      not 500 the whole dashboard.
  it('treats a failing query as an empty season', async () => {
    mockAggregate.mockRejectedValue(new Error('libsql: connection closed'));
    expect(await resolveStatsSeason(2026)).toEqual({
      season: 2026, maxWeek: 0, fallback: false,
    });
  });

  // WHY: three panels ask the same question on one dashboard render. The answer
  //      only moves when a sync lands, so it is not worth four queries a click.
  it('memoises the answer per requested season', async () => {
    seasonsWithData({ 2026: 6 });
    await resolveStatsSeason(2026);
    await resolveStatsSeason(2026);
    expect(mockAggregate).toHaveBeenCalledTimes(1);
  });
});
