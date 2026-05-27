// tests/app/api/leagues/route.test.ts
//
// Tests for GET /api/leagues.
// Mocks @/lib/prisma and @/auth.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: jest.fn() },
  },
}));

jest.mock('@/auth', () => ({ auth: jest.fn() }));

import { GET } from '@/app/api/leagues/route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

const mockFindMany = prisma.league.findMany as jest.MockedFunction<typeof prisma.league.findMany>;
const mockAuth     = auth                  as jest.MockedFunction<typeof auth>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeLeagues = [
  { id: 'lg1', name: 'Alpha League', season: 2025, sleeperLeagueId: '111', createdAt: new Date() },
  { id: 'lg2', name: 'Beta League',  season: 2025, sleeperLeagueId: '222', createdAt: new Date() },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/leagues', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockAuth.mockResolvedValue({ user: { id: '1', role: 'COMMISSIONER' } } as never);
  });

  // WHY: Authenticated users should receive the full league list.
  it('returns 200 with league array when DB returns results', async () => {
    mockFindMany.mockResolvedValueOnce(fakeLeagues as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json() as typeof fakeLeagues;
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('Alpha League');
  });

  // WHY: Unauthenticated requests must be blocked — the league list should not
  //      be publicly accessible.
  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null as never);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  // WHY: DB failure must produce a 500 with an error message so the client
  //      can surface a useful message to the user.
  it('returns 500 with error message when Prisma throws', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('connection refused'));

    const res = await GET();
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/connection refused/);
  });

  // WHY: Empty league list is a valid state (new install, no syncs yet).
  it('returns 200 with an empty array when no leagues exist', async () => {
    mockFindMany.mockResolvedValueOnce([] as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json() as unknown[];
    expect(body).toHaveLength(0);
  });
});
