// tests/unit/lib/odds.test.ts
//
// Tests for the odds helpers in src/lib/odds.ts.
// Mocks global.fetch and resets module state (RouteCache) via jest.resetModules().

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('odds module', () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let getLiveOdds: (apiKey: string) => Promise<unknown>;
  let getNflOdds:  (week: number) => Promise<unknown>;
  let SPORT_PRIORITY: readonly string[];

  // Build a minimal "active sport" entry for the sports list endpoint.
  function activeSport(key: string, title = key) {
    return { key, title, active: true };
  }

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
    getLiveOdds    = mod.getLiveOdds;
    getNflOdds     = mod.getNflOdds;
    SPORT_PRIORITY = mod.SPORT_PRIORITY;
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.useRealTimers();
    jest.resetModules();
    delete process.env.ODDS_API_KEY;
  });

  // ── SPORT_PRIORITY constant ──────────────────────────────────────────────────

  // WHY: The priority order determines which sport's odds are shown in demo mode.
  //      Changing it inadvertently would affect what teams appear in the UI.
  it('SPORT_PRIORITY contains the expected sports in order', () => {
    expect(SPORT_PRIORITY[0]).toBe('basketball_nba');
    expect(SPORT_PRIORITY).toContain('americanfootball_nfl');
    expect(SPORT_PRIORITY.length).toBeGreaterThan(1);
  });

  // ── getLiveOdds() ────────────────────────────────────────────────────────────

  // WHY: Cache hit must return the stored value without any additional fetches,
  //      reducing quota consumption on the Odds API.
  it('getLiveOdds returns cached data without re-fetching', async () => {
    // First call — populate the cache
    const sport = activeSport('basketball_nba', 'NBA');
    const game  = makeGame('Boston Celtics', 'Miami Heat');
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([sport]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([game]),  { status: 200 }));
    await getLiveOdds('key-1');

    // Second call — should hit cache
    const result = await getLiveOdds('key-1');
    expect(result).not.toBeNull();
    // fetch called only twice (both from the first call)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // WHY: A non-ok response from the /sports endpoint must return null gracefully
  //      rather than throwing, since the matchup report should still render.
  it('getLiveOdds returns null when the sports fetch fails', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const result = await getLiveOdds('bad-key');
    expect(result).toBeNull();
  });

  // WHY: If the sports response contains no active sports, there is nothing to
  //      pick odds for — null is the correct "no data" sentinel.
  it('getLiveOdds returns null when no sports are active', async () => {
    const inactiveSport = { key: 'basketball_nba', title: 'NBA', active: false };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([inactiveSport]), { status: 200 }),
    );

    const result = await getLiveOdds('key-1');
    expect(result).toBeNull();
  });

  // WHY: The priority list must be respected — NBA should be chosen over MLB
  //      when both are active, because SPORT_PRIORITY lists NBA first.
  it('getLiveOdds picks the highest-priority active sport', async () => {
    const sports = [
      activeSport('baseball_mlb', 'MLB'),
      activeSport('basketball_nba', 'NBA'), // higher priority
    ];
    const games = [makeGame('Team A', 'Team B')];
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(sports), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(games),  { status: 200 }));

    await getLiveOdds('key-1');

    // The odds URL should contain the NBA sport key
    const oddsCallUrl = (mockFetch.mock.calls[1] as [string, unknown])[0] as string;
    expect(oddsCallUrl).toContain('basketball_nba');
  });

  // WHY: When none of the priority sports are active, getLiveOdds falls back to
  //      any active sport so the demo mode still shows something useful.
  it('getLiveOdds falls back to any active sport when none in priority list are active', async () => {
    const unknownSport = activeSport('lacrosse_pll', 'PLL Lacrosse');
    const games = [makeGame('Redwoods', 'Atlas')];
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([unknownSport]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(games),           { status: 200 }));

    const result = await getLiveOdds('key-1') as Array<{ homeTeam: string }> | null;
    expect(result).not.toBeNull();
  });

  // WHY: A non-ok response from the odds endpoint itself must return null.
  //      Two separate fetches — we must only test the second one failing.
  it('getLiveOdds returns null when the odds fetch fails', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify([activeSport('basketball_nba', 'NBA')]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }));

    const result = await getLiveOdds('key-1');
    expect(result).toBeNull();
  });

  // WHY: An empty games array from the API should return null — there is no data
  //      worth caching or displaying.
  it('getLiveOdds returns null when the games array is empty', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify([activeSport('basketball_nba', 'NBA')]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const result = await getLiveOdds('key-1');
    expect(result).toBeNull();
  });

  // WHY: The returned VegasLine objects must carry homeTeam, awayTeam, total,
  //      spread, and sport fields so the matchup report can render them.
  it('getLiveOdds populates VegasLine fields correctly', async () => {
    const sport = activeSport('basketball_nba', 'NBA');
    const game  = makeGame('Boston Celtics', 'Miami Heat', 215.5, -7.5);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([sport]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([game]),  { status: 200 }));

    const result = await getLiveOdds('key-1') as Array<{
      homeTeam: string; awayTeam: string; total: number; spread: number; sport: string;
    }> | null;

    expect(result).not.toBeNull();
    expect(result![0].homeTeam).toBe('Boston Celtics');
    expect(result![0].awayTeam).toBe('Miami Heat');
    expect(result![0].total).toBe(215.5);
    expect(result![0].spread).toBe(-7.5);
    // sport is derived from the sport title
    expect(typeof result![0].sport).toBe('string');
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
