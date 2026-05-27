// tests/unit/lib/sleeper/client.test.ts
//
// Tests for the Sleeper HTTP client in src/lib/sleeper/client.ts.
// Mocks global.fetch so no real network calls are made.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { sleeperGet, SLEEPER_BASE } from '@/lib/sleeper/client';

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

  // WHY: Default revalidate should be 300 (5 minutes) per the source comments.
  //      Without this default every caller would have to specify it.
  it('uses a default revalidate of 300 seconds when not specified', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await sleeperGet('/league/123');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ next: { revalidate: 300 } }),
    );
  });
});
