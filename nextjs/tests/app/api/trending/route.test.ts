// tests/app/api/trending/route.test.ts
//
// The trending route has module-level cache state (trendingCache / trendingLastFetch).
// To prevent one test's cached data from bleeding into the next, we reset modules
// in beforeEach and re-import GET dynamically so each test gets a clean cache.

import { NextRequest } from 'next/server';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// GET is re-imported in beforeEach — declare the variable at describe scope.
let GET: (req: NextRequest) => Promise<Response>;
let mockFetch: jest.MockedFunction<typeof fetch>;

function makeRequest(queryString = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/trending${queryString}`);
}

const mockAdds = [
  { player_id: '4046', count: 1842 },
  { player_id: '7564', count: 1103 },
];
const mockDrops = [
  { player_id: '2374', count: 983 },
];

describe('GET /api/trending', () => {
  beforeEach(async () => {
    // Destroy module registry so the trending route's module-level Maps are
    // re-created empty for every test. Without this, cached data from one test
    // is served to the next test without calling fetch.
    jest.resetModules();

    // Mock playerCache before importing the route so the route module picks up
    // the mock when it is freshly required by resetModules.
    jest.mock('@/lib/sleeper/playerCache', () => ({
      getPlayerMap: jest.fn<() => Promise<Map<string, unknown>>>().mockResolvedValue(new Map()),
    }));

    // Re-import GET after the module reset so it runs with an empty cache.
    const mod = await import('@/app/api/trending/route');
    GET = mod.GET as typeof GET;

    // Set up the fetch spy after the module import.
    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.resetModules();
  });

  it('returns both adds and drops when no type specified', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(mockAdds), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockDrops), { status: 200 }));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json() as { adds: unknown[]; drops: unknown[] };
    expect(body.adds).toHaveLength(2);
    expect(body.drops).toHaveLength(1);
    expect(body.adds[0]).toMatchObject({ player_id: '4046', type: 'add' });
    expect(body.drops[0]).toMatchObject({ player_id: '2374', type: 'drop' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns only adds when type=add', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockAdds), { status: 200 }),
    );

    const res = await GET(makeRequest('?type=add'));
    expect(res.status).toBe(200);

    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ type: 'add' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/trending/add'),
      expect.anything(),
    );
  });

  it('returns only drops when type=drop', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockDrops), { status: 200 }),
    );

    const res = await GET(makeRequest('?type=drop'));
    expect(res.status).toBe(200);

    const body = await res.json() as unknown[];
    expect(body[0]).toMatchObject({ type: 'drop' });
  });

  it('respects limit and lookback_hours query params', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await GET(makeRequest('?limit=10&lookback_hours=6'));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('lookback_hours=6'),
      expect.anything(),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=10'),
      expect.anything(),
    );
  });

  it('caps limit at 100', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await GET(makeRequest('?limit=999'));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=100'),
      expect.anything(),
    );
  });

  it('returns 400 for invalid type', async () => {
    const res = await GET(makeRequest('?type=invalid'));
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/type must be/);
  });

  it('returns 400 for out-of-range lookback_hours', async () => {
    const res = await GET(makeRequest('?lookback_hours=999'));
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/lookback_hours/);
  });

  it('returns 502 when Sleeper API is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    const res = await GET(makeRequest('?type=add'));
    expect(res.status).toBe(502);
  });
});