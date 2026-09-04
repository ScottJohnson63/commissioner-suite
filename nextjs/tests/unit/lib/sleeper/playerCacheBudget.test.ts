// tests/unit/lib/sleeper/playerCacheBudget.test.ts
//
// One question, asked adversarially: can /players/nfl be hit more than once a
// day? Sleeper asks callers to keep to one call per day for this ~10 MB
// endpoint, and says exceeding it risks being blocked.
//
// The tests in playerCache.test.ts feed the cache hand-written mock responses.
// These do not: they stand up a fake SleeperCache table with real row
// semantics (including the compare-and-set predicate the claim relies on) and
// then attack it — concurrent callers, a fleet of cold processes sharing that
// one table, downloads that fail every time, and the day boundary — counting
// the calls that actually reach the network.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('@/lib/prisma', () => ({
  prisma: { sleeperCache: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(), create: jest.fn() } },
}));

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface Row { key: string; data: string; fetchedAt: Date }

describe('/players/nfl daily call budget', () => {
  // The shared SleeperCache table. It outlives module resets, exactly like the
  // real database outlives a serverless instance.
  let table: Map<string, Row>;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  // jest.resetModules() clears a spy's call history AND its implementation, so
  // neither can be used to count across cold starts. The counter lives out
  // here, and the implementation is reinstalled on every cold start.
  let downloads: number;
  let respond: () => Promise<Response>;

  const playerJson = JSON.stringify({ '4046': { full_name: 'Tom Brady', position: 'QB', team: 'TB' } });

  /** Wires the prisma mock to `table` with the same semantics Prisma gives us. */
  async function wireDb(): Promise<void> {
    const { prisma } = await import('@/lib/prisma');
    const sc = prisma.sleeperCache as unknown as Record<string, jest.Mock>;

    sc.findUnique.mockImplementation((async (args: { where: { key: string } }) =>
      table.get(args.where.key) ?? null) as never);

    // updateMany applies the `fetchedAt < cutoff` predicate and reports how many
    // rows it touched — the compare-and-set the daily claim is built on.
    sc.updateMany.mockImplementation((async (args: {
      where: { key: string; fetchedAt?: { lt: Date } };
      data: { data: string; fetchedAt: Date };
    }) => {
      const row = table.get(args.where.key);
      if (!row) return { count: 0 };
      const lt = args.where.fetchedAt?.lt;
      if (lt && row.fetchedAt.getTime() >= lt.getTime()) return { count: 0 };
      table.set(args.where.key, { ...row, ...args.data });
      return { count: 1 };
    }) as never);

    // create enforces the primary key, so only one racer can win it.
    sc.create.mockImplementation((async (args: { data: Row }) => {
      if (table.has(args.data.key)) throw new Error('UNIQUE constraint failed: SleeperCache.key');
      table.set(args.data.key, { ...args.data });
      return args.data;
    }) as never);

    sc.upsert.mockImplementation((async (args: {
      where: { key: string }; update: Partial<Row>; create: Row;
    }) => {
      const existing = table.get(args.where.key);
      table.set(args.where.key, existing
        ? { ...existing, ...args.update, fetchedAt: args.update.fetchedAt ?? new Date() }
        : { ...args.create, fetchedAt: args.create.fetchedAt ?? new Date() });
      return table.get(args.where.key);
    }) as never);
  }

  interface ColdProcess {
    getPlayerMap:     () => Promise<Map<string, unknown>>;
    getPlayerMapSafe: () => Promise<Map<string, unknown>>;
  }

  /** A cold process: fresh module state, same shared table and same counter. */
  async function coldStart(): Promise<ColdProcess> {
    jest.resetModules();
    await wireDb();
    mockFetch.mockImplementation((async (url: unknown) => {
      if (String(url).endsWith('/players/nfl')) downloads++;
      return respond();
    }) as never);
    const mod = await import('@/lib/sleeper/playerCache');
    return mod as unknown as ColdProcess;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-04T12:00:00.000Z'));
    table = new Map();
    downloads = 0;
    respond = async () => new Response(playerJson, { status: 200 });
    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.useRealTimers();
    jest.resetModules();
  });

  // WHY: Every dashboard panel asks for this map at once on a cold process.
  //      Without single-flight they each start their own 10 MB download.
  it('collapses concurrent callers into one download', async () => {
    const { getPlayerMap } = await coldStart();

    await Promise.all(Array.from({ length: 25 }, () => getPlayerMap()));

    expect(downloads).toBe(1);
  });

  // WHY: The real deployment is serverless. Each request can land on a process
  //      with an empty in-memory cache, so the DB row is the only thing
  //      standing between the fleet and 100 downloads a day.
  it('holds to one download across a fleet of cold processes', async () => {
    for (let i = 0; i < 20; i++) {
      const { getPlayerMap } = await coldStart();
      await getPlayerMap();
    }

    expect(downloads).toBe(1);
  });

  // WHY: This is the case that actually gets an app blocked. A failing download
  //      caches nothing, so without a claim recorded up front, every request
  //      for the rest of the day retries it.
  it('does not retry after a failed download, even across cold processes', async () => {
    respond = async () => { throw new Error('socket hang up'); };

    for (let i = 0; i < 20; i++) {
      const { getPlayerMap } = await coldStart();
      await expect(getPlayerMap()).rejects.toThrow();
    }

    expect(downloads).toBe(1);
  });

  // WHY: Same, for the shape a rate-limited or unhealthy Sleeper actually
  //      returns — a non-ok response rather than a thrown connection error.
  it('does not retry after a 429 from Sleeper', async () => {
    respond = async () => new Response('Too Many Requests', { status: 429 });

    for (let i = 0; i < 10; i++) {
      const { getPlayerMap } = await coldStart();
      await expect(getPlayerMap()).rejects.toThrow();
    }

    expect(downloads).toBe(1);
  });

  // WHY: The budget is per day, not forever — the map does have to refresh.
  it('allows exactly one more download after the day rolls over', async () => {
    let { getPlayerMap } = await coldStart();
    await getPlayerMap();
    expect(downloads).toBe(1);

    // Just under a day: still refused, from a cold process with no memory of it.
    jest.setSystemTime(new Date(Date.now() + ONE_DAY_MS - 60_000));
    ({ getPlayerMap } = await coldStart());
    await getPlayerMap();
    expect(downloads).toBe(1);

    // Past the day boundary: one, and only one, more.
    jest.setSystemTime(new Date(Date.now() + 120_000));
    for (let i = 0; i < 10; i++) {
      ({ getPlayerMap } = await coldStart());
      await getPlayerMap();
    }
    expect(downloads).toBe(2);
  });

  // WHY: A partial outage must not become a loophole — a failed write-back is
  //      one of the ways the cache ends up empty with the day already spent.
  //      The cost is explicit and accepted: processes that never received the
  //      map go without names until tomorrow rather than spending a second
  //      call. The one that downloaded it still has it in memory.
  it('does not retry when the download succeeds but the write-back fails', async () => {
    const breakWriteBack = async (): Promise<void> => {
      const { prisma } = await import('@/lib/prisma');
      const sc = prisma.sleeperCache as unknown as Record<string, jest.Mock>;
      // Claim writes still work; only the data upsert fails.
      sc.upsert.mockImplementation((async () => { throw new Error('DB write failed'); }) as never);
    };

    const first = await coldStart();
    await breakWriteBack();
    expect((await first.getPlayerMap()).size).toBeGreaterThan(0);  // served from this process
    expect(downloads).toBe(1);

    for (let i = 0; i < 9; i++) {
      const later = await coldStart();
      await breakWriteBack();
      // Nothing stored and no slot left: callers get an empty map, not a call.
      expect((await later.getPlayerMapSafe()).size).toBe(0);
    }

    expect(downloads).toBe(1);
  });
});
