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

// Without this the list's live-name overlay would reach the real Sleeper API.
jest.mock('@/lib/sleeper/liveNames', () => ({
  fetchLeagueNames: jest.fn(),
}));

import { GET } from '@/app/api/leagues/route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { fetchLeagueNames } from '@/lib/sleeper/liveNames';

const mockFindMany = prisma.league.findMany as jest.MockedFunction<typeof prisma.league.findMany>;
const mockAuth     = auth                  as jest.MockedFunction<typeof auth>;
const mockLeagueNames = fetchLeagueNames as jest.MockedFunction<typeof fetchLeagueNames>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeLeagues = [
  { id: 'lg1', name: 'Alpha League', season: 2025, sleeperLeagueId: '111', createdAt: new Date() },
  { id: 'lg2', name: 'Beta League',  season: 2025, sleeperLeagueId: '222', createdAt: new Date() },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/leagues', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockLeagueNames.mockReset();
    mockAuth.mockResolvedValue({ user: { id: '1', role: 'COMMISSIONER' } } as never);
    // Default: Sleeper has no opinion, so stored names pass through unchanged.
    mockLeagueNames.mockResolvedValue(new Map());
  });

  // WHY: this is the bug that started the redesign. League.name is written only
  //      by a sync, and the league feed has no cron, so a league renamed in
  //      Sleeper kept its old name on the cards indefinitely.
  it('returns the live Sleeper name over the stored one', async () => {
    mockFindMany.mockResolvedValue(fakeLeagues as never);
    mockLeagueNames.mockResolvedValue(new Map([['111', 'Discount Double Perc']]));

    const res  = await GET();
    const body = await res.json() as { sleeperLeagueId: string; name: string }[];

    expect(body.find((l) => l.sleeperLeagueId === '111')?.name).toBe('Discount Double Perc');
  });

  // WHY: GET /api/leagues is on every page load and gates what the app shows at
  //      all. One unreachable league must not blank the others, and a total
  //      Sleeper outage must not empty the allowlist.
  it('keeps stored names for leagues Sleeper cannot answer for', async () => {
    mockFindMany.mockResolvedValue(fakeLeagues as never);
    mockLeagueNames.mockResolvedValue(new Map([['111', 'Renamed Alpha']]));

    const res  = await GET();
    const body = await res.json() as { sleeperLeagueId: string; name: string }[];

    expect(body.find((l) => l.sleeperLeagueId === '111')?.name).toBe('Renamed Alpha');
    expect(body.find((l) => l.sleeperLeagueId === '222')?.name).toBe('Beta League');
    expect(body).toHaveLength(2);
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
