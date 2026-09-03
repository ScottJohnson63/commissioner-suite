// tests/unit/lib/odds.test.ts
//
// Tests for the odds helpers in src/lib/odds.ts.
// Mocks global.fetch and resets module state (RouteCache) via jest.resetModules().

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('odds module', () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let getNflOdds: (week: number) => Promise<unknown>;

  // Build a minimal game odds entry for the odds endpoint.
  function makeGame(home: string, away: string, total = 45.5, spread = -3.5) {
    return {
      home_team: home,
      away_team: away,
      bookmakers: [{
        markets: [
          {
            key: 'totals',
            outcomes: [{ name: 'Over', price: -110, point: total }],
          },
          {
            key: 'spreads',
            outcomes: [
              { name: home, price: -110, point: spread },
              { name: away, price: -110, point: -spread },
            ],
          },
        ],
      }],
    };
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    jest.resetModules();

    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;

    const mod = await import('@/lib/odds');
    getNflOdds = mod.getNflOdds;
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.useRealTimers();
    jest.resetModules();
    delete process.env.ODDS_API_KEY;
  });

  // ── getNflOdds() ─────────────────────────────────────────────────────────────

  // WHY: Without an API key the function must return null immediately rather than
  //      making a fetch call with an undefined key in the URL.
  it('getNflOdds returns null when ODDS_API_KEY is not set', async () => {
    delete process.env.ODDS_API_KEY;
    const result = await getNflOdds(5);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // WHY: Cache hit should prevent a second fetch. This is important — the NFL
  //      odds endpoint has a quota cost.
  it('getNflOdds returns cached data on second call', async () => {
    process.env.ODDS_API_KEY = 'test-key';
    const games = [makeGame('Kansas City Chiefs', 'Buffalo Bills')];
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(games), { status: 200 }),
    );

    await getNflOdds(5);
    await getNflOdds(5); // second call — should hit cache

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // WHY: A successful fetch must return an array of VegasLine objects with the
  //      correct team names, total, and spread extracted from the response.
  it('getNflOdds returns lines for all games on a successful fetch', async () => {
    process.env.ODDS_API_KEY = 'test-key';
    const games = [
      makeGame('Kansas City Chiefs', 'Buffalo Bills', 49.5, -3),
      makeGame('Dallas Cowboys',     'New York Giants', 44,  -6),
    ];
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(games), { status: 200 }),
    );

    const result = await getNflOdds(5) as Array<{ homeTeam: string }> | null;
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].homeTeam).toBe('Kansas City Chiefs');
  });

  // WHY: A non-ok response from the NFL odds endpoint returns null gracefully.
  it('getNflOdds returns null when the fetch response is not ok', async () => {
    process.env.ODDS_API_KEY = 'test-key';
    mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

    const result = await getNflOdds(5);
    expect(result).toBeNull();
  });

  // WHY: If fetch throws (network error), the catch block must return null —
  //      the matchup report should still render without odds data.
  it('getNflOdds returns null when fetch throws', async () => {
    process.env.ODDS_API_KEY = 'test-key';
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result = await getNflOdds(5);
    expect(result).toBeNull();
  });
});
