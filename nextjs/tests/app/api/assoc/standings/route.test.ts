// tests/app/api/assoc/standings/route.test.ts
//
// Tests for GET /api/assoc/standings and the rankFromBrackets logic.
// Mocks @/lib/prisma and @/lib/sleeper/client.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: jest.fn() },
  },
}));

jest.mock('@/lib/sleeper/client', () => ({
  SLEEPER_BASE: 'https://api.sleeper.app/v1',
  sleeperGet: jest.fn(),
}));

import { GET } from '@/app/api/assoc/standings/route';
import { prisma } from '@/lib/prisma';
import { sleeperGet } from '@/lib/sleeper/client';

const mockLeagueFindUnique = prisma.league.findUnique as jest.MockedFunction<typeof prisma.league.findUnique>;
const mockSleeperGet       = sleeperGet               as jest.MockedFunction<typeof sleeperGet>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGet(leagueId?: string): NextRequest {
  const qs = leagueId ? `?leagueId=${leagueId}` : '';
  return new NextRequest(`http://localhost/api/assoc/standings${qs}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeLeague = {
  id: 'lg1',
  name: 'Test League',
  season: 2025,
  sleeperLeagueId: 'sleeper-999',
};

// Minimal Sleeper league info with a previous season
const sleeperLeagueInfo = { previous_league_id: 'sleeper-998' };

// A small bracket: 2-team championship final.
// t1 and t2 both came from winners path (t1_from: null means seeded directly).
const winnersBracket = [
  { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2, t1_from: null, t2_from: null },
];
const losersBracket: unknown[] = [];

const fakeUsers = [
  { user_id: 'u1', display_name: 'Alice', metadata: { team_name: 'Alice FC' } },
  { user_id: 'u2', display_name: 'Bob',   metadata: { team_name: 'Bob SC'  } },
];

const fakeRosters = [
  { roster_id: 1, owner_id: 'u1', settings: { wins: 10, losses: 3, fpts: 1500, fpts_against: 1200, division: 1 } },
  { roster_id: 2, owner_id: 'u2', settings: { wins: 8,  losses: 5, fpts: 1300, fpts_against: 1100, division: 2 } },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/assoc/standings', () => {
  beforeEach(() => {
    mockLeagueFindUnique.mockReset();
    mockSleeperGet.mockReset();
  });

  // WHY: leagueId is required. Missing it must return 400 without any DB calls.
  it('returns 400 when leagueId query param is missing', async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(400);
    expect(mockLeagueFindUnique).not.toHaveBeenCalled();
  });

  // WHY: If the league doesn't exist in the DB the endpoint can't proceed —
  //      return 404 to tell the client the leagueId is invalid.
  it('returns 404 when the league is not found in the DB', async () => {
    mockLeagueFindUnique.mockResolvedValueOnce(null as never);

    const res = await GET(makeGet('lg-nonexistent'));
    expect(res.status).toBe(404);
  });

  // WHY: A league without a previous_league_id has no last-season standings —
  //      return 404 with a clear message rather than returning empty data.
  it('returns 404 when the Sleeper league has no previous_league_id', async () => {
    mockLeagueFindUnique.mockResolvedValueOnce(fakeLeague as never);
    mockSleeperGet.mockResolvedValueOnce({ previous_league_id: null } as never);

    const res = await GET(makeGet('lg1'));
    expect(res.status).toBe(404);
  });

  // WHY: Happy path — all data available, returns standings sorted by rank.
  it('returns 200 with standings sorted by rank on the happy path', async () => {
    mockLeagueFindUnique.mockResolvedValueOnce(fakeLeague as never);
    mockSleeperGet
      .mockResolvedValueOnce(sleeperLeagueInfo)         // league info
      .mockResolvedValueOnce(fakeUsers)                  // users
      .mockResolvedValueOnce(fakeRosters)                // rosters
      .mockResolvedValueOnce(winnersBracket)             // winners bracket
      .mockResolvedValueOnce(losersBracket);             // losers bracket

    const res = await GET(makeGet('lg1'));
    expect(res.status).toBe(200);

    const body = await res.json() as { standings: Array<{ rank: number; rosterId: number }> };
    expect(body.standings).toHaveLength(2);
    // Standings must be sorted rank ascending (1 first)
    expect(body.standings[0].rank).toBe(1);
    expect(body.standings[1].rank).toBe(2);
  });

  // WHY: The championship winner (rank 1) must have isChampion: true so the UI
  //      can display a trophy icon.
  it('marks the rank-1 team as champion', async () => {
    mockLeagueFindUnique.mockResolvedValueOnce(fakeLeague as never);
    mockSleeperGet
      .mockResolvedValueOnce(sleeperLeagueInfo)
      .mockResolvedValueOnce(fakeUsers)
      .mockResolvedValueOnce(fakeRosters)
      .mockResolvedValueOnce(winnersBracket)
      .mockResolvedValueOnce(losersBracket);

    const res = await GET(makeGet('lg1'));
    const body = await res.json() as { standings: Array<{ rank: number; isChampion: boolean }> };

    const champion = body.standings.find((s) => s.rank === 1);
    expect(champion?.isChampion).toBe(true);
  });
});
