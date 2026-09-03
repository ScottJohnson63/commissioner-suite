// tests/unit/lib/sleeper/client.test.ts
//
// Tests for the Sleeper HTTP client in src/lib/sleeper/client.ts.
// Mocks global.fetch so no real network calls are made.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { sleeperGet, clearInFlight, SLEEPER_BASE, SLEEPER_TTL } from '@/lib/sleeper/client';

describe('SLEEPER_BASE', () => {
  // WHY: Any change to the base URL would silently break every Sleeper API call.
  //      Hard-pinning the value here makes the breakage obvious at review time.
  it('is the correct Sleeper API v1 base URL', () => {
    expect(SLEEPER_BASE).toBe('https://api.sleeper.app/v1');
  });
});

describe('sleeperGet()', () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    // Spy on global.fetch so we can control its return value per test.
    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;
    // Coalescing is process-wide by design; each test starts with none pending.
    clearInFlight();
  });

  afterEach(() => {
    // Restore the real fetch so other test files are not affected.
    mockFetch.mockRestore();
  });

  // WHY: The happy path must return the parsed JSON body typed as T.
  //      Verifies the function correctly chains fetch → res.json().
  it('returns parsed JSON for a successful 200 response', async () => {
    const payload = { league_id: '123', name: 'Test League' };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 }),
    );

    const result = await sleeperGet<typeof payload>('/league/123');
    expect(result).toEqual(payload);
    // Confirm the full URL was constructed by prepending SLEEPER_BASE
    expect(mockFetch).toHaveBeenCalledWith(
      `${SLEEPER_BASE}/league/123`,
      expect.anything(),
    );
  });

  // WHY: A non-2xx response must throw rather than returning an empty/null body.
  //      Callers rely on try/catch to surface meaningful errors to the user.
  it('throws an Error for a 4xx HTTP status', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );

    await expect(sleeperGet('/league/nonexistent')).rejects.toThrow(
      'Sleeper 404: /league/nonexistent',
    );
  });

  // WHY: 5xx responses should also throw — the caller should not silently swallow
  //      a server error from Sleeper.
  it('throws an Error for a 5xx HTTP status', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(sleeperGet('/players/nfl')).rejects.toThrow('Sleeper 500');
  });

  // WHY: The revalidate parameter feeds the Next.js fetch cache. Passing a custom
  //      value must be forwarded in the options object so the cache TTL is respected.
  it('passes the revalidate option to fetch when provided', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await sleeperGet('/league/123/rosters', 0);

    // next: { revalidate: 0 } bypasses the cache for time-critical reads.
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ next: { revalidate: 0 } }),
    );
  });

  // WHY: An unspecified call must land on the shared league window rather than
  //      on some per-call-site number. Asserted against the constant, not a
  //      literal, so tuning the policy in one place does not break this test —
  //      the point is that the default *is* SLEEPER_TTL.LEAGUE, not what that
  //      value happens to be today.
  it('defaults to the shared league TTL when not specified', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await sleeperGet('/league/123');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ next: { revalidate: SLEEPER_TTL.LEAGUE } }),
    );
  });

  // WHY: The redesign turns on this window being short. If someone raises it
  //      back to minutes, names go stale again across every live route at once —
  //      so the bound is asserted explicitly, with the reason attached.
  it('keeps the league window short enough to read as live', () => {
    expect(SLEEPER_TTL.LEAGUE).toBeLessThanOrEqual(60);
  });
});

// ── Coalescing identical in-flight requests ──────────────────────────────────
//
// Next's Data Cache deduplicates within one route-handler invocation, but not
// across concurrent ones: ten parallel requests reading one lapsed URL schedule
// ten background revalidations of it. Measured against `next start` on 16.3.3 —
// the origin counter went from 1 to 11. A dashboard is several panels asking
// about the same league at the same moment, so this is the ordinary case.

describe('sleeperGet() request coalescing', () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;
    clearInFlight();
  });

  afterEach(() => { mockFetch.mockRestore(); });

  /** A fetch that does not settle until the test says so. */
  function deferredFetch(body: unknown) {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockFetch.mockImplementation(async () => {
      await gate;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    return { release };
  }

  // WHY: the whole point. Ten panels asking for one league at one moment must
  //      reach Sleeper once.
  it('makes one request when ten callers ask for the same path at once', async () => {
    const { release } = deferredFetch({ name: 'Test League' });

    const all = Promise.all(
      Array.from({ length: 10 }, () => sleeperGet<{ name: string }>('/league/123')),
    );
    release();
    const results = await all;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual({ name: 'Test League' });
  });

  // WHY: sharing one parsed object between callers would let a route that sorts
  //      or splices what it got back corrupt what another route is reading. Each
  //      caller parses the shared response text into its own value.
  it('gives each caller its own object, not a shared reference', async () => {
    const { release } = deferredFetch([{ roster_id: 1 }, { roster_id: 2 }]);

    const both = Promise.all([
      sleeperGet<{ roster_id: number }[]>('/league/123/rosters'),
      sleeperGet<{ roster_id: number }[]>('/league/123/rosters'),
    ]);
    release();
    const [a, b] = await both;

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.length = 0;              // one caller mutating its copy...
    expect(b).toHaveLength(2); // ...must not empty the other's
  });

  // WHY: this is a stampede guard, not a second cache. Holding results past the
  //      request would silently override the TTL the caller asked for, and the
  //      Data Cache is what decides how long an answer lives.
  it('does not serve a settled request to a later caller', async () => {
    // A fresh Response per call: a body can only be read once, so reusing one
    // instance would fail on the second read for reasons unrelated to caching.
    mockFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ n: 1 }), { status: 200 }));

    await sleeperGet('/state/nfl', SLEEPER_TTL.NFL_STATE);
    await sleeperGet('/state/nfl', SLEEPER_TTL.NFL_STATE);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // WHY: two callers wanting different freshness are not asking the same
  //      question, and the Data Cache stores them as separate entries.
  it('does not join callers asking with different TTLs', async () => {
    const { release } = deferredFetch({ ok: true });

    const both = Promise.all([
      sleeperGet('/league/123', SLEEPER_TTL.LEAGUE),
      sleeperGet('/league/123', SLEEPER_TTL.TRENDING),
    ]);
    release();
    await both;

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // WHY: FRESH exists so a sync or a refresh button gets an answer fetched after
  //      the user asked. Joining it to a request already in flight would hand
  //      back one fetched before.
  it('never joins a FRESH request to one already running', async () => {
    const { release } = deferredFetch({ ok: true });

    const both = Promise.all([
      sleeperGet('/league/123', SLEEPER_TTL.FRESH),
      sleeperGet('/league/123', SLEEPER_TTL.FRESH),
    ]);
    release();
    await both;

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // WHY: a shared failure must reach every caller as a failure — and as one
  //      failed call rather than ten retries.
  it('fails every joined caller once, without a second request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockFetch.mockImplementation(async () => {
      await gate;
      return new Response('nope', { status: 500 });
    });

    const all = Promise.allSettled([
      sleeperGet('/league/123'),
      sleeperGet('/league/123'),
      sleeperGet('/league/123'),
    ]);
    release();
    const settled = await all;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    for (const s of settled) expect(s.status).toBe('rejected');
  });

  // WHY: a failure must not poison the slot. The next caller has to be able to
  //      try again.
  it('lets a later caller retry after a failure', async () => {
    mockFetch.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(sleeperGet('/league/123')).rejects.toThrow();

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(sleeperGet('/league/123')).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
