// tests/app/api/nfl/proxy.test.ts

import { GET } from '@/app/api/nfl/[...path]/route';
import { NextRequest } from 'next/server';
import { jest, describe, it, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';

let mockFetch: jest.MockedFunction<typeof fetch>;

beforeAll(() => {
  mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;
});

afterAll(() => {
  mockFetch.mockRestore();
});

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nfl/${path}`);
}

describe('GET /api/nfl/[...path]', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('proxies a successful response from FastAPI', async () => {
    const mockData = [{ player_id: '123', name: 'Tom Brady' }];
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockData), { status: 200 }),
    );

    const res = await GET(makeRequest('players'), {
      params: Promise.resolve({ path: ['players'] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockData);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/nfl/players',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('forwards query params to FastAPI', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const req = new NextRequest(
      'http://localhost:3000/api/nfl/weekly?season=2024&week=5',
    );
    await GET(req, { params: Promise.resolve({ path: ['weekly'] }) });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/nfl/weekly?season=2024&week=5',
      expect.anything(),
    );
  });

  it('returns 502 when FastAPI is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await GET(makeRequest('players'), {
      params: Promise.resolve({ path: ['players'] }),
    });

    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/ECONNREFUSED/);
  });

  it('forwards non-200 status codes from FastAPI', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 }),
    );

    const res = await GET(makeRequest('players'), {
      params: Promise.resolve({ path: ['players'] }),
    });

    expect(res.status).toBe(404);
  });

  it('proxies nested paths correctly', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await GET(makeRequest('stats/weekly'), {
      params: Promise.resolve({ path: ['stats', 'weekly'] }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/nfl/stats/weekly'),
      expect.anything(),
    );
  });
});