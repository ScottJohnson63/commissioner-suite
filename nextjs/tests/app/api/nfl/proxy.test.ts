// tests/app/api/nfl/proxy.test.ts

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { GET } from '@/app/api/nfl/[...path]/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

import { prisma } from '@/lib/prisma';

const mockQueryRaw = prisma.$queryRawUnsafe as jest.MockedFunction<
  typeof prisma.$queryRawUnsafe
>;

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nfl/${path}`);
}

const mockLeaders = [
  {
    playerId: '4046',
    playerDisplayName: 'Tom Brady',
    position: 'QB',
    team: 'TB',
    headshot: null,
    statValue: 4200,
    gamesPlayed: 17,
  },
];

describe('GET /api/nfl/leaders', () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
  });

  it('returns aggregated leaders for the requested stat', async () => {
    mockQueryRaw.mockResolvedValueOnce(mockLeaders as never);

    const res = await GET(makeRequest('leaders?season=2025&stat=passingYards'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].playerDisplayName).toBe('Tom Brady');
    // season and limit are bound parameters, never interpolated.
    expect(mockQueryRaw).toHaveBeenCalledWith(
      expect.stringContaining('SUM(passingYards)'),
      2025,
      25,
    );
  });

  it('rejects a stat column that is not on the allowlist', async () => {
    const res = await GET(
      makeRequest('leaders?season=2025&stat=password'),
      { params: Promise.resolve({ path: ['leaders'] }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid stat column/);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('ignores a position that is not a short alpha abbreviation', async () => {
    mockQueryRaw.mockResolvedValueOnce([] as never);

    await GET(makeRequest("leaders?season=2025&position=QB'%20OR%201=1--"), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(mockQueryRaw).toHaveBeenCalledWith(
      expect.not.stringContaining('OR 1=1'),
      2025,
      25,
    );
  });

  it('applies a valid position filter', async () => {
    mockQueryRaw.mockResolvedValueOnce([] as never);

    await GET(makeRequest('leaders?season=2025&position=qb'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(mockQueryRaw).toHaveBeenCalledWith(
      expect.stringContaining("AND position = 'QB'"),
      2025,
      25,
    );
  });

  it('caps the limit at 100', async () => {
    mockQueryRaw.mockResolvedValueOnce([] as never);

    await GET(makeRequest('leaders?season=2025&limit=5000'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(mockQueryRaw).toHaveBeenCalledWith(expect.any(String), 2025, 100);
  });

  it('normalises bigint counts returned by Turso', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...mockLeaders[0], statValue: BigInt(4200), gamesPlayed: BigInt(17) },
    ] as never);

    const res = await GET(makeRequest('leaders?season=2025'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    const body = await res.json();
    expect(body[0].statValue).toBe(4200);
    expect(body[0].gamesPlayed).toBe(17);
  });

  it('returns 500 when the query throws', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await GET(makeRequest('leaders?season=2025'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/DB connection failed/);
  });

  it('returns 404 for an unknown endpoint', async () => {
    const res = await GET(makeRequest('weekly'), {
      params: Promise.resolve({ path: ['weekly'] }),
    });

    expect(res.status).toBe(404);
  });
});
