// tests/app/api/trending/route.test.ts

import { GET } from '@/app/api/trending/route';
import { NextRequest } from 'next/server';
import { jest, describe, it, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';

let mockFetch: jest.MockedFunction<typeof fetch>;

beforeAll(() => {
  mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;
});

afterAll(() => {
  mockFetch.mockRestore();
});

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
  beforeEach(() => {
    mockFetch.mockReset();
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