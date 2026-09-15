// tests/unit/lib/cards/snapshot.test.ts
//
// Covers the cached pool facts in src/lib/cards/snapshot.ts.
//
// The caching mechanics — the row, the memo, single-flighting, and the rule
// that an overtaken measurement is never published — belong to DbCache and are
// pinned in tests/unit/lib/dbCache.test.ts. What is left here is this module's
// own two decisions: what it measures, and that a rebuild drops it.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGroupBy = jest.fn<() => Promise<{ tier: string; _count: number }[]>>();
const mockSeasons = jest.fn<() => Promise<number[]>>();
const mockDeleteMany = jest.fn<() => Promise<unknown>>();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    sleeperCache:   {
      findUnique: async () => null,
      upsert:     async () => ({}),
      deleteMany: () => mockDeleteMany(),
    },
    cardDefinition: { groupBy: () => mockGroupBy() },
  },
}));
jest.mock('@/lib/nflSeasons', () => ({ statSeasons: () => mockSeasons() }));

import {
  poolFacts, poolSeasons, invalidatePoolFacts, __resetPoolFactsMemo,
} from '@/lib/cards/snapshot';

beforeEach(() => {
  jest.clearAllMocks();
  __resetPoolFactsMemo();
  mockSeasons.mockResolvedValue([2023, 2024]);
  mockGroupBy.mockResolvedValue([
    { tier: 'BRONZE', _count: 900 },
    { tier: 'GOLD',   _count: 100 },
  ]);
});

describe('poolFacts()', () => {
  // WHY: the pool size is summed from the tier split rather than counted
  //      separately. The groupBy has already walked every row, so a second
  //      count() would walk them again for a number the first one implies —
  //      14,000 row reads for arithmetic.
  it('derives the pool size from the tier split', async () => {
    expect(await poolFacts()).toEqual({
      seasons: [2023, 2024],
      poolSize: 1000,
      byTier: { BRONZE: 900, GOLD: 100 },
    });
  });

  // WHY: the seasons are a fact about the stat table, not about the pool, so
  //      they come from the cache that is keyed on the stat table. Scanning for
  //      them here is what this whole change removed.
  it('takes the seasons from the stat-season cache', async () => {
    await poolFacts();

    expect(mockSeasons).toHaveBeenCalledTimes(1);
  });

  it('returns just the seasons from poolSeasons()', async () => {
    expect(await poolSeasons()).toEqual([2023, 2024]);
  });
});

describe('invalidatePoolFacts()', () => {
  // WHY: a rebuild replaces every card, so the size and tier split it was
  //      measured from are gone. Delegated to DbCache, but the delegation is
  //      what the rebuild routes rely on, so it is pinned here.
  it('drops the cached facts', async () => {
    await poolFacts();
    await invalidatePoolFacts();
    await poolFacts();

    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockGroupBy).toHaveBeenCalledTimes(2);
  });
});
