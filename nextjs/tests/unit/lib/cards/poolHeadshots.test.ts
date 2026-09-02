// tests/unit/lib/cards/poolHeadshots.test.ts
//
// Covers which portrait rebuildCardPool writes onto a card.
//
// Kept apart from pool.test.ts, which mocks the database away entirely to test
// the ranking rule as a pure function. This is the other half of the builder:
// the join that decides what a card shows, and in particular that a *null*
// resolved portrait is an answer rather than a missing value.
//
// It matters because the raw nflverse column lies. Its nfl.com URL answers 200
// with the league's generic faceless-helmet silhouette for about half the pool,
// so trusting it put a black helmet on ~6,900 cards — and since a 200 is not an
// error, PlayerCard's onError fallback never fired to rescue them.

import { describe, it, expect, beforeEach } from '@jest/globals';

const queryRaw = jest.fn();
const headshotFindMany = jest.fn();
const rosterFindMany = jest.fn();
const createMany = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw:         (...args: unknown[]) => queryRaw(...args),
    nflSeasonRoster:   { findMany: (...args: unknown[]) => rosterFindMany(...args) },
    nflPlayerHeadshot: { findMany: (...args: unknown[]) => headshotFindMany(...args) },
    cardDefinition: {
      findMany:   jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: (...args: unknown[]) => createMany(...args),
    },
  },
}));

import { rebuildCardPool } from '@/lib/cards/pool';

const SILHOUETTE = 'https://static.www.nfl.com/image/private/f_auto,q_auto/league/silhouette';
const ESPN = 'https://a.espncdn.com/i/headshots/nfl/players/full/1755.png';

/** The one stat row every test in here builds its single card from. */
function statRow(overrides: Record<string, unknown> = {}) {
  return {
    playerId:      '00-0001',
    playerName:    'Edgerrin James',
    position:      'RB',
    team:          'IND',
    fantasyPoints: 300,
    gamesPlayed:   16,
    headshot:      SILHOUETTE,
    ...overrides,
  };
}

/** Every card handed to createMany across the run, flattened. */
function writtenCards(): { playerId: string; headshot: string | null }[] {
  return createMany.mock.calls.flatMap(
    (call) => (call[0] as { data: { playerId: string; headshot: string | null }[] }).data,
  );
}

/** Wires $queryRaw to answer both of the builder's raw queries. */
function withStats(rows: ReturnType<typeof statRow>[]) {
  queryRaw.mockImplementation((strings: TemplateStringsArray) =>
    strings.join('').includes('DISTINCT season')
      ? Promise.resolve([{ season: 2003 }])
      : Promise.resolve(rows),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  rosterFindMany.mockResolvedValue([]);
  headshotFindMany.mockResolvedValue([]);
});

describe('rebuildCardPool() portraits', () => {
  // WHY: the recovery this whole change exists for. The stat table still holds
  //      the silhouette URL — it is synced data and is not rewritten — so the
  //      resolved portrait has to win, or the ESPN photograph never reaches a
  //      card.
  it('prefers the resolved portrait over the raw nflverse column', async () => {
    withStats([statRow()]);
    headshotFindMany.mockResolvedValue([{ playerId: '00-0001', url: ESPN }]);

    await rebuildCardPool();

    expect(writtenCards()[0].headshot).toBe(ESPN);
  });

  // WHY: the subtle half. A resolved row holding null means "checked, and no
  //      photograph exists anywhere" — the signal that sends the card to its
  //      team logo. Read as a miss it would fall back to the silhouette URL,
  //      which is exactly the bug, so `has` and `??` are not interchangeable
  //      here.
  it('treats a resolved null as no photograph rather than as a miss', async () => {
    withStats([statRow()]);
    headshotFindMany.mockResolvedValue([{ playerId: '00-0001', url: null }]);

    await rebuildCardPool();

    expect(writtenCards()[0].headshot).toBeNull();
  });

  // WHY: the table is filled by a separate sync, so a checkout that has never
  //      run it must still build a usable pool rather than a deck of logos.
  it('falls back to the raw column for a player nobody has checked', async () => {
    withStats([statRow()]);

    await rebuildCardPool();

    expect(writtenCards()[0].headshot).toBe(SILHOUETTE);
  });
});
