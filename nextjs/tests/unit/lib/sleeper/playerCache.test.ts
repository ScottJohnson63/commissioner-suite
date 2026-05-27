// tests/unit/lib/sleeper/playerCache.test.ts
//
// Tests for the Sleeper player-map cache in src/lib/sleeper/playerCache.ts.
// Mocks @/lib/prisma and global.fetch. Resets module state via jest.resetModules()
// so the module-level in-memory cache (memCache/memCacheTs) is fresh per test.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock Prisma before any imports.
jest.mock('@/lib/prisma', () => ({
  prisma: {
    sleeperCache: {
      findUnique: jest.fn(),
      upsert:     jest.fn(),
    },
  },
}));

// We'll import the module fresh inside each test via jest.resetModules() + import().

describe('getPlayerMap()', () => {
  let mockFetch:      jest.MockedFunction<typeof fetch>;
  let getPlayerMap:   () => Promise<Map<string, unknown>>;
  let mockFindUnique: jest.MockedFunction<(...args: unknown[]) => unknown>;
  let mockUpsert:     jest.MockedFunction<(...args: unknown[]) => unknown>;

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Minimal valid JSON payload for the Sleeper /players/nfl endpoint.
  const playerJson = JSON.stringify({
    '4046': { full_name: 'Tom Brady',   position: 'QB',  team: 'TB'   },
    '7564': { full_name: 'Justin Jefferson', position: 'WR', team: 'MIN' },
    '9999': { first_name: 'Fake', last_name: 'Player', position: 'RB', team: null },
    // Entry without a name — should be skipped
    '0000': { position: 'DEF', team: null },
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    jest.resetModules();

    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;

    // Re-import to get a fresh module with empty memCache.
    const playerCacheMod = await import('@/lib/sleeper/playerCache');
    getPlayerMap = playerCacheMod.getPlayerMap;

    // Re-import the now-fresh prisma mock reference.
    const { prisma } = await import('@/lib/prisma');
    mockFindUnique = prisma.sleeperCache.findUnique as jest.MockedFunction<(...args: unknown[]) => unknown>;
    mockUpsert     = prisma.sleeperCache.upsert     as jest.MockedFunction<(...args: unknown[]) => unknown>;
    mockFindUnique.mockReset();
    mockUpsert.mockReset();
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.useRealTimers();
    jest.resetModules();
  });

  // WHY: The in-memory cache is the fastest path — if it's fresh (<24 h) neither
  //      the DB nor the network should be touched.
  it('returns in-memory cache when it is fresh', async () => {
    // Seed memory by doing a successful fetch first.
    mockFindUnique.mockResolvedValueOnce(null); // no DB entry
    mockFetch.mockResolvedValueOnce(
      new Response(playerJson, { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    mockUpsert.mockResolvedValueOnce({} as never);

    await getPlayerMap(); // populates memCache

    // Second call — should not hit DB or fetch
    mockFindUnique.mockReset();
    mockFetch.mockReset();
    const result = await getPlayerMap();

    expect(result.size).toBeGreaterThan(0);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // WHY: After the memory TTL expires, the DB is consulted before making a
  //      network call. Avoids hitting the Sleeper API unnecessarily.
  it('falls through to DB cache when in-memory cache is stale', async () => {
    // Seed memory
    mockFindUnique.mockResolvedValueOnce(null);
    mockFetch.mockResolvedValueOnce(new Response(playerJson, { status: 200 }));
    mockUpsert.mockResolvedValueOnce({} as never);
    await getPlayerMap();

    // Advance past the 24-hour memory TTL
    jest.advanceTimersByTime(ONE_DAY_MS + 1);

    // DB returns a fresh entry (younger than 24 h)
    const freshDbEntry = {
      key:       'nfl_players',
      data:      playerJson,
      fetchedAt: new Date(Date.now() - 1000), // 1 second ago
    };
    mockFindUnique.mockResolvedValueOnce(freshDbEntry);
    mockFetch.mockReset();

    const result = await getPlayerMap();
    expect(result.size).toBeGreaterThan(0);
    // Should have used DB, not fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // WHY: A DB hit younger than 24 hours must populate the in-memory cache
  //      so the next call doesn't hit the DB again.
  it('populates in-memory cache from DB and returns correct data', async () => {
    // Clear memory (no prior call in this test)
    const freshDbEntry = {
      key:       'nfl_players',
      data:      playerJson,
      fetchedAt: new Date(), // very fresh
    };
    mockFindUnique.mockResolvedValueOnce(freshDbEntry);

    const result = await getPlayerMap();
    expect(result.get('4046')).toMatchObject({ name: 'Tom Brady', position: 'QB', team: 'TB' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // WHY: A DB entry older than 24 hours must be bypassed and the API fetched.
  //      Stale player data would cause wrong names/positions in projections.
  it('falls through to fetch when DB cache is older than 24 hours', async () => {
    const staleDbEntry = {
      key:       'nfl_players',
      data:      playerJson,
      fetchedAt: new Date(Date.now() - (ONE_DAY_MS + 5000)), // 24h + 5s ago
    };
    mockFindUnique.mockResolvedValueOnce(staleDbEntry);
    mockFetch.mockResolvedValueOnce(new Response(playerJson, { status: 200 }));
    mockUpsert.mockResolvedValueOnce({} as never);

    const result = await getPlayerMap();
    expect(result.size).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // WHY: A successful Sleeper API fetch must return the parsed map AND persist
  //      the raw JSON to the DB for the next process restart.
  it('persists fetched player data to the DB via upsert', async () => {
    mockFindUnique.mockResolvedValueOnce(null); // no DB entry
    mockFetch.mockResolvedValueOnce(new Response(playerJson, { status: 200 }));
    mockUpsert.mockResolvedValueOnce({} as never);

    await getPlayerMap();

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where:  { key: 'nfl_players' },
        create: expect.objectContaining({ data: playerJson }),
      }),
    );
  });

  // WHY: A non-ok response from the Sleeper API must throw so the caller knows
  //      the player map is unavailable (they can handle it gracefully upstream).
  it('throws when the Sleeper API returns a non-ok response', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockFetch.mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }));

    await expect(getPlayerMap()).rejects.toThrow('Sleeper players API 429');
  });

  // WHY: A DB write failure must be non-fatal. The player map was fetched
  //      successfully, so it should still be returned even if upsert throws.
  it('returns the player map even if the DB upsert fails', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockFetch.mockResolvedValueOnce(new Response(playerJson, { status: 200 }));
    mockUpsert.mockRejectedValueOnce(new Error('DB write failed'));

    const result = await getPlayerMap();
    // Should still return data despite upsert failure
    expect(result.size).toBeGreaterThan(0);
  });

  // WHY: A DB read failure must be silently swallowed and fall through to the
  //      API fetch, not crash the server.
  it('falls through to fetch silently when DB read throws', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('DB connection lost'));
    mockFetch.mockResolvedValueOnce(new Response(playerJson, { status: 200 }));
    mockUpsert.mockResolvedValueOnce({} as never);

    const result = await getPlayerMap();
    expect(result.size).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ── parsePlayerJson edge cases ────────────────────────────────────────────────
// parsePlayerJson is not exported, but its behaviour is exercised indirectly
// via getPlayerMap(). The tests below verify the parsing rules by inspecting
// the returned map entries.

describe('parsePlayerJson edge cases (via getPlayerMap)', () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let getPlayerMap: () => Promise<Map<string, { name: string; position: string; team: string | null }>>;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    jest.resetModules();

    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;

    const { prisma } = await import('@/lib/prisma');
    (prisma.sleeperCache.findUnique as jest.MockedFunction<(...args: unknown[]) => unknown>).mockResolvedValue(null);
    (prisma.sleeperCache.upsert     as jest.MockedFunction<(...args: unknown[]) => unknown>).mockResolvedValue({} as never);

    const mod = await import('@/lib/sleeper/playerCache');
    getPlayerMap = mod.getPlayerMap as typeof getPlayerMap;
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.useRealTimers();
    jest.resetModules();
  });

  // WHY: full_name is the preferred name field. First+last concatenation is the fallback.
  it('uses full_name when available', async () => {
    const json = JSON.stringify({ p1: { full_name: 'Patrick Mahomes', position: 'QB', team: 'KC' } });
    mockFetch.mockResolvedValueOnce(new Response(json, { status: 200 }));
    const map = await getPlayerMap();
    expect(map.get('p1')?.name).toBe('Patrick Mahomes');
  });

  // WHY: When full_name is absent, first_name + last_name must be concatenated
  //      with a space — no double-space, no missing space.
  it('concatenates first_name and last_name when full_name is absent', async () => {
    const json = JSON.stringify({ p1: { first_name: 'Justin', last_name: 'Jefferson', position: 'WR', team: 'MIN' } });
    mockFetch.mockResolvedValueOnce(new Response(json, { status: 200 }));
    const map = await getPlayerMap();
    expect(map.get('p1')?.name).toBe('Justin Jefferson');
  });

  // WHY: Entries with no name at all are placeholder/DEF entries that should not
  //      appear in the player map — they would pollute autocomplete and projections.
  it('skips entries that have no name', async () => {
    const json = JSON.stringify({ p1: { position: 'DEF', team: null } });
    mockFetch.mockResolvedValueOnce(new Response(json, { status: 200 }));
    const map = await getPlayerMap();
    expect(map.has('p1')).toBe(false);
  });

  // WHY: position may be absent on some DST/DEF entries; fantasy_positions[0]
  //      is the fallback used by the display layer.
  it('uses fantasy_positions[0] as position fallback when position is absent', async () => {
    const json = JSON.stringify({
      p1: { full_name: 'DEF Team', fantasy_positions: ['DEF'], team: 'SF' },
    });
    mockFetch.mockResolvedValueOnce(new Response(json, { status: 200 }));
    const map = await getPlayerMap();
    expect(map.get('p1')?.position).toBe('DEF');
  });

  // WHY: Free agents and retired players have a null team. The UI must handle
  //      this gracefully (show "FA" or similar), not crash on undefined access.
  it('sets team to null for free agents', async () => {
    const json = JSON.stringify({ p1: { full_name: 'Retired Player', position: 'QB', team: null } });
    mockFetch.mockResolvedValueOnce(new Response(json, { status: 200 }));
    const map = await getPlayerMap();
    expect(map.get('p1')?.team).toBeNull();
  });
});
