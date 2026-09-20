// tests/unit/lib/nflSeasons.test.ts
//
// Covers the cached stat-season list in src/lib/nflSeasons.ts.
//
// The caching mechanics live in DbCache and are pinned in
// tests/unit/lib/dbCache.test.ts. What matters here is the query this module
// runs, the ordering contract its two exports promise, and the string-encoded
// integers Turso hands back.

import { it, expect, jest, beforeEach } from '@jest/globals';

const mockQueryRaw = jest.fn<() => Promise<{ season: number | string }[]>>();
/** The SQL of the last scan, reassembled from the tagged template. */
let lastSql = '';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    sleeperCache: {
      findUnique: async () => null,
      upsert:     async () => ({}),
      deleteMany: async () => ({}),
    },
    $queryRaw: (strings: TemplateStringsArray) => {
      lastSql = strings.join('');
      return mockQueryRaw();
    },
  },
}));

import {
  statSeasons, statSeasonsDescending, __resetStatSeasonsMemo,
} from '@/lib/nflSeasons';

beforeEach(() => {
  jest.clearAllMocks();
  __resetStatSeasonsMemo();
  mockQueryRaw.mockResolvedValue([{ season: 2023 }, { season: 2024 }, { season: 2025 }]);
});

// WHY: the pool builder and the Draft Deck's picker both read it oldest-first,
//      and the Statistics tab reads it newest-first. One cached list serving
//      both is the point — two would be two scans.
it('returns the seasons oldest first', async () => {
  expect(await statSeasons()).toEqual([2023, 2024, 2025]);
});

it('returns the seasons newest first for the stats picker', async () => {
  expect(await statSeasonsDescending()).toEqual([2025, 2024, 2023]);
});

// WHY: reversing must not mutate what the other caller sees. Both read the same
//      cached array, so an in-place reverse would flip it underneath them.
it('does not reorder the cached list when reversing', async () => {
  await statSeasonsDescending();

  expect(await statSeasons()).toEqual([2023, 2024, 2025]);
});

// WHY: Turso's Hrana JSON protocol encodes integers as strings. A season left
//      as "2025" sorts and compares as text, and reaches the client as a string
//      where a number is expected.
it('coerces the string-encoded integers Turso returns', async () => {
  mockQueryRaw.mockResolvedValue([{ season: '2024' }, { season: '2025' }]);

  expect(await statSeasons()).toEqual([2024, 2025]);
});

// WHY: issue #98. sync_nfl_defense.py writes 32 team-defense rows for the live
//      season the moment it kicks off — assembled from the team feed, position
//      'DEF', fantasy points left NULL. That was enough to put the season in
//      this list and make it the Statistics tab's default, where the
//      fantasy-points leaderboard it opens on then had nothing to show. A
//      season belongs here once it has players in it.
it('ignores a season that holds only team-defense rows', async () => {
  await statSeasons();

  expect(lastSql).toMatch(/position IS NULL OR position <> 'DEF'/);
});

// WHY: the scan is the cost being removed — ~448,000 rows for two dozen
//      integers. Asking twice in one process must hit the table once.
it('scans the stat table only once per process', async () => {
  await statSeasons();
  await statSeasonsDescending();

  expect(mockQueryRaw).toHaveBeenCalledTimes(1);
});
