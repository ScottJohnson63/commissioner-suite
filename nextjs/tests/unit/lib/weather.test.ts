// tests/unit/lib/weather.test.ts
//
// Tests for the Open-Meteo weather helper in src/lib/weather.ts.
// Mocks global.fetch and controls time with fake timers.
//
// NOTE: weather.ts uses a module-level RouteCache instance. We reset modules
// between tests via jest.resetModules() to prevent cache state from leaking.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('getWeather()', () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let getWeather: (team: string, week: number) => Promise<unknown>;

  // Build a minimal Open-Meteo-shaped response for an outdoor stadium.
  // Weather at index 0 represents the "best" time slot chosen by the algorithm.
  function makeOpenMeteoResponse(overrides: {
    temp?: number;
    wind?: number;
    precip?: number;
  } = {}) {
    const temp   = overrides.temp   ?? 55;
    const wind   = overrides.wind   ?? 5;
    const precip = overrides.precip ?? 10;

    // The function finds the first future time with the lowest (Sunday 1pm) score.
    // We use a Sunday 13:00 timestamp that is clearly in the future (year 2099).
    const sundayAt1pm = '2099-10-05T13:00';
    return {
      hourly: {
        time:                      [sundayAt1pm],
        temperature_2m:            [temp],
        precipitation_probability: [precip],
        wind_speed_10m:            [wind],
      },
    };
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    // Pin "now" to a fixed past date so all fixture timestamps are in the future.
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    // Reset modules so the module-level weatherCache is always empty.
    jest.resetModules();
    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;

    const mod = await import('@/lib/weather');
    getWeather = mod.getWeather;
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.useRealTimers();
    jest.resetModules();
  });

  // WHY: Dome stadiums are unaffected by outdoor weather. Returning null without
  //      fetching saves an API call and avoids misleading data in the matchup report.
  it('returns null for a dome stadium without calling fetch', async () => {
    const result = await getWeather('ARI', 1); // Arizona — dome: true
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // WHY: An unknown team code has no stadium entry. Returning null gracefully is
  //      better than crashing with a TypeError on the undefined entry.
  it('returns null for an unknown team code without calling fetch', async () => {
    const result = await getWeather('XYZ', 1);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // WHY: Core happy-path: good conditions (low wind, low precip, mild temp)
  //      should return a WeatherInfo object with "Good conditions" note.
  it('returns Good conditions note when no adverse weather thresholds are crossed', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeOpenMeteoResponse({ temp: 55, wind: 5, precip: 10 })), { status: 200 }),
    );

    const result = await getWeather('BAL', 1) as { note: string } | null;
    expect(result).not.toBeNull();
    expect(result!.note).toBe('Good conditions');
  });

  // WHY: Wind > 20 mph is known to reduce passing efficiency. The note must flag
  //      it so the AI agent can factor it into projections.
  it('includes "High wind" in the note when wind speed exceeds 20 mph', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeOpenMeteoResponse({ wind: 25 })), { status: 200 }),
    );

    const result = await getWeather('BAL', 1) as { note: string } | null;
    expect(result!.note).toContain('High wind');
  });

  // WHY: Precipitation > 60% significantly impacts passing/receiving stats.
  it('includes "Rain likely" in the note when precipitation probability exceeds 60%', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeOpenMeteoResponse({ precip: 75 })), { status: 200 }),
    );

    const result = await getWeather('BAL', 1) as { note: string } | null;
    expect(result!.note).toContain('Rain likely');
  });

  // WHY: Temperatures below 20°F are genuinely dangerous and affect player
  //      performance and game style (more rushing, less passing).
  it('includes "Extreme cold" in the note when temperature is below 20°F', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeOpenMeteoResponse({ temp: 10 })), { status: 200 }),
    );

    const result = await getWeather('BAL', 1) as { note: string } | null;
    expect(result!.note).toContain('Extreme cold');
  });

  // WHY: Multiple adverse conditions should all be present in the note, joined
  //      by '; ' so the matchup report can display each condition clearly.
  it('joins multiple condition notes with "; "', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify(makeOpenMeteoResponse({ wind: 30, precip: 80, temp: 5 })),
        { status: 200 },
      ),
    );

    const result = await getWeather('BAL', 1) as { note: string } | null;
    expect(result!.note).toContain('High wind');
    expect(result!.note).toContain('Rain likely');
    expect(result!.note).toContain('Extreme cold');
    // Conditions separated by '; '
    expect(result!.note).toMatch(/;/);
  });

  // WHY: A non-ok HTTP response must return null, not throw. The matchup report
  //      should degrade gracefully when Open-Meteo is unavailable.
  it('returns null when the fetch response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Service Unavailable', { status: 503 }),
    );

    const result = await getWeather('BAL', 1);
    expect(result).toBeNull();
  });

  // WHY: If fetch itself throws (network failure), the catch block must return
  //      null so the matchup report still renders without weather data.
  it('returns null when fetch throws a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));

    const result = await getWeather('BAL', 1);
    expect(result).toBeNull();
  });

  // WHY: The second call within the TTL must use the cache and not issue another
  //      fetch request. This is the main reason the cache exists (1 req / hour).
  it('returns cached data on a second call without re-fetching', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(makeOpenMeteoResponse()), { status: 200 }),
    );

    await getWeather('BAL', 1);
    await getWeather('BAL', 1); // should hit cache

    // fetch must only have been called once
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // WHY: The WeatherInfo object must carry team, tempF, windMph, precipPct, and
  //      stadiumName so the matchup report can render all relevant fields.
  it('returns a WeatherInfo with team, tempF, windMph, precipPct, stadiumName', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeOpenMeteoResponse({ temp: 45, wind: 8, precip: 20 })), { status: 200 }),
    );

    const result = await getWeather('BAL', 1) as {
      team: string; tempF: number; windMph: number; precipPct: number; stadiumName: string;
    } | null;

    expect(result).not.toBeNull();
    expect(result!.team).toBe('BAL');
    expect(result!.tempF).toBe(45);
    expect(result!.windMph).toBe(8);
    expect(result!.precipPct).toBe(20);
    expect(result!.stadiumName).toBe('M&T Bank Stadium');
  });
});
