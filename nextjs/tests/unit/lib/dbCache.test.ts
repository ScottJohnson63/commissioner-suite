// tests/unit/lib/dbCache.test.ts
//
// Covers the cached-row primitive in src/lib/dbCache.ts.
//
// Everything this class does is about how often it reaches the database, which
// is a property no feature test would notice: a cache that has quietly stopped
// caching returns exactly the right answers, and the only symptom is the bill.
// So the assertions here are almost all call counts.
//
// The two races at the bottom are the reason this is a class at all rather than
// a pattern copied per call site. Each one can publish a wrong answer for a
// whole day, to every instance, and neither is visible in a single-threaded
// reading of the code.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindUnique = jest.fn<() => Promise<{ data: string; fetchedAt: Date } | null>>();
const mockUpsert     = jest.fn<() => Promise<unknown>>();
const mockDeleteMany = jest.fn<() => Promise<unknown>>();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    sleeperCache: {
      findUnique: () => mockFindUnique(),
      upsert:     () => mockUpsert(),
      deleteMany: () => mockDeleteMany(),
    },
  },
}));

import { DbCache } from '@/lib/dbCache';

const DAY = 24 * 60 * 60 * 1000;

/** A stored row holding `value`, written `ageMs` ago. */
function row(value: unknown, ageMs = 0) {
  return { data: JSON.stringify(value), fetchedAt: new Date(Date.now() - ageMs) };
}

const isNumbers = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => typeof n === 'number');

/** A cache over a measurement that counts its own calls. */
function makeCache(measure = jest.fn<() => Promise<number[]>>()) {
  measure.mockResolvedValue([1, 2, 3]);
  return { measure, cache: new DbCache<number[]>('k', DAY, measure, isNumbers) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindUnique.mockResolvedValue(null);
});

describe('reading', () => {
  // WHY: the whole point. An empty cache falls back to the measurement and
  //      writes down what it found, so nobody else pays for it.
  it('measures and stores when nothing is cached', async () => {
    const { measure, cache } = makeCache();

    expect(await cache.read()).toEqual([1, 2, 3]);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  // WHY: the scans this replaces cost hundreds of thousands of row reads.
  //      Serving a stored row must not run the measurement at all.
  it('serves a fresh row without measuring', async () => {
    const { measure, cache } = makeCache();
    mockFindUnique.mockResolvedValue(row([2025]));

    expect(await cache.read()).toEqual([2025]);
    expect(measure).not.toHaveBeenCalled();
  });

  // WHY: the memo is what makes repeat calls inside one process free — a second
  //      call must not even read the row.
  it('does not re-read the row once memoised', async () => {
    const { cache } = makeCache();

    await cache.read();
    await cache.read();

    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  // WHY: callers arrive together on a cold cache — the collection route asks
  //      for the seasons and the pack allowance in one Promise.all. Without
  //      single-flighting the request pays for the scan twice, which is the
  //      exact cost this class exists to remove.
  it('collapses concurrent cold reads into one measurement', async () => {
    const { measure, cache } = makeCache();

    const [a, b] = await Promise.all([cache.read(), cache.read()]);

    expect(a).toBe(b);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  // WHY: a row past its age may describe state that changed somewhere this
  //      process never saw.
  it('re-measures a row past its maximum age', async () => {
    const { measure, cache } = makeCache();
    mockFindUnique.mockResolvedValue(row([1999], DAY + 1000));

    expect(await cache.read()).toEqual([1, 2, 3]);
    expect(measure).toHaveBeenCalledTimes(1);
  });
});

describe('degrading', () => {
  // WHY: the measurement is slow, not broken. A cache that cannot be read or
  //      parsed must fall back to it rather than fail the page — a malformed
  //      blob should never be why a member cannot see a deck.
  it.each([
    ['an unreadable row', () => { mockFindUnique.mockRejectedValue(new Error('down')); }],
    ['an unparseable row', () => {
      mockFindUnique.mockResolvedValue({ data: 'not json', fetchedAt: new Date() });
    }],
    ['a row of the wrong shape', () => { mockFindUnique.mockResolvedValue(row({ nope: 1 })); }],
  ])('falls back to measuring on %s', async (_label, arrange) => {
    const { measure, cache } = makeCache();
    arrange();

    expect(await cache.read()).toEqual([1, 2, 3]);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  // WHY: the cache is an optimisation. Failing to write it is not a reason to
  //      fail the read that produced the value.
  it('still answers when the row cannot be written', async () => {
    const { cache } = makeCache();
    mockUpsert.mockRejectedValue(new Error('read-only'));

    expect(await cache.read()).toEqual([1, 2, 3]);
  });

  // WHY: a rebuild that worked must not be reported as failed because its cache
  //      eviction could not reach the database.
  it('does not throw when the row cannot be deleted', async () => {
    const { cache } = makeCache();
    mockDeleteMany.mockRejectedValue(new Error('down'));

    await expect(cache.invalidate()).resolves.toBeUndefined();
  });
});

describe('invalidating', () => {
  // WHY: both layers have to go. Clearing only the row leaves the memo serving
  //      the old answer in the very process that just invalidated it.
  it('drops the row and the memo', async () => {
    const { measure, cache } = makeCache();

    await cache.read();
    await cache.invalidate();
    await cache.read();

    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  // WHY: **the race that pins a wrong answer for a day.** A rebuild does
  //      deleteMany then ~70 chunked inserts, so a measurement overlapping it
  //      sees a half-written table. Its write would land *after* the
  //      invalidation deleted the row, storing that reading for the full
  //      maximum age on every instance. It must return its value to its own
  //      caller and store nothing.
  it('does not publish a measurement it overtook', async () => {
    let release!: (v: number[]) => void;
    const measure = jest.fn<() => Promise<number[]>>()
      .mockReturnValueOnce(new Promise<number[]>((res) => { release = res; }))
      .mockResolvedValue([7, 8, 9]);
    const cache = new DbCache<number[]>('k', DAY, measure, isNumbers);

    const inFlight = cache.read();      // starts measuring against the old state
    await cache.invalidate();           // the rebuild lands
    release([0]);                       // the stale reading finally returns

    // Its own caller still gets an answer...
    expect(await inFlight).toEqual([0]);
    // ...but nothing was written down for anybody else.
    expect(mockUpsert).not.toHaveBeenCalled();
    // ...and the next reader measures afresh rather than seeing the stale memo.
    expect(await cache.read()).toEqual([7, 8, 9]);
  });

  // WHY: the other half of the same race. An invalidation must also detach the
  //      in-flight read, or a caller arriving just after it would be handed the
  //      pre-rebuild measurement as if it were current.
  it('does not hand a later reader the overtaken measurement', async () => {
    let release!: (v: number[]) => void;
    const measure = jest.fn<() => Promise<number[]>>()
      .mockReturnValueOnce(new Promise<number[]>((res) => { release = res; }))
      .mockResolvedValue([7, 8, 9]);
    const cache = new DbCache<number[]>('k', DAY, measure, isNumbers);

    void cache.read();
    await cache.invalidate();

    const after = cache.read();
    release([0]);

    expect(await after).toEqual([7, 8, 9]);
  });
});
