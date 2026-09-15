// tests/unit/lib/cards/snapshot.test.ts
//
// Covers the cached pool facts in src/lib/cards/snapshot.ts.
//
// This module exists for one reason — a Draft Deck load must not scan the stat
// table — so the properties worth pinning are all about how often it reaches
// the database, not about the numbers themselves. A cache that quietly stops
// caching looks exactly like a working one until the bill arrives, which is the
// failure this file is here to catch.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindUnique = jest.fn<() => Promise<{ data: string; fetchedAt: Date } | null>>();
const mockUpsert     = jest.fn<() => Promise<unknown>>();
const mockDeleteMany = jest.fn<() => Promise<unknown>>();
const mockGroupBy    = jest.fn<() => Promise<{ tier: string; _count: number }[]>>();
const mockSeasons    = jest.fn<() => Promise<number[]>>();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    sleeperCache:   {
      findUnique: () => mockFindUnique(),
      upsert:     () => mockUpsert(),
      deleteMany: () => mockDeleteMany(),
    },
    cardDefinition: { groupBy: () => mockGroupBy() },
  },
}));
jest.mock('@/lib/cards/pool', () => ({ availableSeasons: () => mockSeasons() }));

import {
  poolFacts, poolSeasons, invalidatePoolFacts, __resetPoolFactsMemo,
} from '@/lib/cards/snapshot';

/** A stored row holding `facts`, written `ageMs` ago. */
function row(facts: unknown, ageMs = 0) {
  return { data: JSON.stringify(facts), fetchedAt: new Date(Date.now() - ageMs) };
}

const MEASURED = { seasons: [2023, 2024], byTier: [
  { tier: 'BRONZE', _count: 900 },
  { tier: 'GOLD',   _count: 100 },
] };

beforeEach(() => {
  jest.clearAllMocks();
  __resetPoolFactsMemo();
  mockSeasons.mockResolvedValue(MEASURED.seasons);
  mockGroupBy.mockResolvedValue(MEASURED.byTier);
  mockFindUnique.mockResolvedValue(null);
});

describe('poolFacts()', () => {
  // WHY: the whole point. An empty cache must fall back to the scans, write
  //      what it found, and report a pool size summed from the tier split
  //      rather than counted a second time.
  it('measures once and stores the result when nothing is cached', async () => {
    const facts = await poolFacts();

    expect(facts).toEqual({
      seasons: [2023, 2024],
      poolSize: 1000,
      byTier: { BRONZE: 900, GOLD: 100 },
    });
    expect(mockSeasons).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  // WHY: the scan this module replaces cost ~448,000 row reads. Serving a
  //      stored row must not touch the stat table at all.
  it('serves a fresh row without scanning anything', async () => {
    mockFindUnique.mockResolvedValue(
      row({ seasons: [2025], poolSize: 623, byTier: { BRONZE: 623 } }),
    );

    expect(await poolFacts()).toEqual({
      seasons: [2025], poolSize: 623, byTier: { BRONZE: 623 },
    });
    expect(mockSeasons).not.toHaveBeenCalled();
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  // WHY: the collection route asks for the seasons and the pack allowance in
  //      one Promise.all, so two callers hit a cold cache simultaneously.
  //      Without single-flighting, the request pays for the scans twice — the
  //      exact case this module was written to remove.
  it('collapses concurrent cold reads into one measurement', async () => {
    const [a, b] = await Promise.all([poolFacts(), poolFacts()]);

    expect(a).toBe(b);
    expect(mockSeasons).toHaveBeenCalledTimes(1);
    expect(mockGroupBy).toHaveBeenCalledTimes(1);
  });

  // WHY: the memo is what makes repeat calls inside one process free. A second
  //      call must not even read the cache row.
  it('does not re-read the row once memoised', async () => {
    await poolFacts();
    await poolFacts();

    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  // WHY: a row older than the safety net describes a pool that may have been
  //      rebuilt somewhere this process never saw.
  it('re-measures a row past its maximum age', async () => {
    mockFindUnique.mockResolvedValue(
      row({ seasons: [1999], poolSize: 1, byTier: { BRONZE: 1 } }, 25 * 60 * 60 * 1000),
    );

    expect((await poolFacts()).seasons).toEqual([2023, 2024]);
    expect(mockSeasons).toHaveBeenCalledTimes(1);
  });

  // WHY: the scans are slow, not broken. A cache that cannot be read or parsed
  //      must degrade to the old behaviour rather than fail the page — a
  //      malformed blob should never be the reason a member cannot see a deck.
  it.each([
    ['an unreadable row', () => { mockFindUnique.mockRejectedValue(new Error('down')); }],
    ['an unparseable row', () => {
      mockFindUnique.mockResolvedValue({ data: 'not json', fetchedAt: new Date() });
    }],
    ['a row of the wrong shape', () => { mockFindUnique.mockResolvedValue(row({ nope: 1 })); }],
  ])('falls back to measuring on %s', async (_label, arrange) => {
    arrange();

    expect((await poolFacts()).poolSize).toBe(1000);
    expect(mockSeasons).toHaveBeenCalledTimes(1);
  });

  // WHY: the cache is an optimisation. Failing to write it is not a reason to
  //      fail the read that produced the value.
  it('still answers when the row cannot be written', async () => {
    mockUpsert.mockRejectedValue(new Error('read-only'));

    expect((await poolFacts()).poolSize).toBe(1000);
  });
});

describe('poolSeasons()', () => {
  it('returns just the seasons', async () => {
    expect(await poolSeasons()).toEqual([2023, 2024]);
  });
});

describe('invalidatePoolFacts()', () => {
  // WHY: a rebuild replaces every card. Both layers have to go, or the memo
  //      keeps serving the old size in the very process that rebuilt it.
  it('drops the row and the memo', async () => {
    await poolFacts();
    await invalidatePoolFacts();
    await poolFacts();

    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockSeasons).toHaveBeenCalledTimes(2);
  });

  // WHY: a rebuild that worked must not be reported as failed because its
  //      cache eviction could not reach the database.
  it('does not throw when the row cannot be deleted', async () => {
    mockDeleteMany.mockRejectedValue(new Error('down'));

    await expect(invalidatePoolFacts()).resolves.toBeUndefined();
  });
});
