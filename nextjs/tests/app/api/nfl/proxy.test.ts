// tests/app/api/nfl/proxy.test.ts

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { GET } from '@/app/api/nfl/[...path]/route';
import { NextRequest } from 'next/server';

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  prisma: {
    nflWeeklyStat: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockFindMany = prisma.nflWeeklyStat.findMany as jest.MockedFunction<
  typeof prisma.nflWeeklyStat.findMany
>;

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nfl/${path}`);
}

const mockStats = [
  {
    id: '1',
    playerId: '4046',
    playerName: 'Tom Brady',
    playerDisplayName: 'Tom Brady',
    position: 'QB',
    positionGroup: 'QB',
    season: 2025,
    week: 5,
    passingYards: 320,
    fantasyPointsPpr: 28.5,
  },
];

describe('GET /api/nfl/weekly', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('returns weekly stats for a season', async () => {
    mockFindMany.mockResolvedValueOnce(mockStats as any);

    const res = await GET(makeRequest('weekly?season=2025'), {
      params: Promise.resolve({ path: ['weekly'] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].playerName).toBe('Tom Brady');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { season: 2025 },
      }),
    );
  });

  it('filters by week when provided', async () => {
    mockFindMany.mockResolvedValueOnce(mockStats as any);

    await GET(makeRequest('weekly?season=2025&week=5'), {
      params: Promise.resolve({ path: ['weekly'] }),
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { season: 2025, week: 5 },
      }),
    );
  });

  it('filters by position when provided', async () => {
    mockFindMany.mockResolvedValueOnce(mockStats as any);

    await GET(makeRequest('weekly?season=2025&position=QB'), {
      params: Promise.resolve({ path: ['weekly'] }),
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { season: 2025, position: 'QB' },
      }),
    );
  });

  it('returns 500 when Prisma throws', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await GET(makeRequest('weekly?season=2025'), {
      params: Promise.resolve({ path: ['weekly'] }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/DB connection failed/);
  });

  it('returns 404 for unknown endpoint', async () => {
    const res = await GET(makeRequest('unknown'), {
      params: Promise.resolve({ path: ['unknown'] }),
    });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/nfl/players', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('returns distinct players for a season', async () => {
    mockFindMany.mockResolvedValueOnce(mockStats as any);

    const res = await GET(makeRequest('players?season=2025'), {
      params: Promise.resolve({ path: ['players'] }),
    });

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: ['playerId'],
        where: { season: 2025 },
      }),
    );
  });
});