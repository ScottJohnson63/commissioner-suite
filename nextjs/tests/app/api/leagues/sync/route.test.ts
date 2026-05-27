// tests/app/api/leagues/sync/route.test.ts
//
// Tests for POST /api/leagues/sync.
// Mocks @/lib/prisma, @/lib/sleeper/sync, and @/lib/audit.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      upsert: jest.fn(),
    },
    team: {
      upsert: jest.fn(),
    },
  },
}));

jest.mock('@/lib/sleeper/sync', () => ({
  fetchLeagueData: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  writeAuditLog: jest.fn(),
}));

import { POST } from '@/app/api/leagues/sync/route';
import { prisma } from '@/lib/prisma';
import { fetchLeagueData } from '@/lib/sleeper/sync';
import { writeAuditLog } from '@/lib/audit';

const mockFetchLeagueData = fetchLeagueData as jest.MockedFunction<typeof fetchLeagueData>;
const mockLeagueUpsert    = prisma.league.upsert as jest.MockedFunction<typeof prisma.league.upsert>;
const mockTeamUpsert      = prisma.team.upsert   as jest.MockedFunction<typeof prisma.team.upsert>;
const mockAuditLog        = writeAuditLog        as jest.MockedFunction<typeof writeAuditLog>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Minimal team set — just 2 teams to keep the fixture small.
const fakeSyncData = {
  leagueId: 'sleeper-999',
  name:     'Test League',
  season:   2025,
  teams: [
    { id: '1', name: 'Team 1', divisionId: 0 as const },
    { id: '2', name: 'Team 2', divisionId: 1 as const },
  ],
};

const fakeLeagueRecord = { id: 'db-lg-1', sleeperLeagueId: 'sleeper-999', name: 'Test League', season: 2025 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/leagues/sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/leagues/sync', () => {
  beforeEach(() => {
    mockFetchLeagueData.mockReset();
    mockLeagueUpsert.mockReset();
    mockTeamUpsert.mockReset();
    mockAuditLog.mockReset();

    // Default happy-path mocks
    mockFetchLeagueData.mockResolvedValue(fakeSyncData as never);
    mockLeagueUpsert.mockResolvedValue(fakeLeagueRecord as never);
    mockTeamUpsert.mockResolvedValue({} as never);
    mockAuditLog.mockResolvedValue(undefined);
  });

  // WHY: Happy-path — valid leagueIds array causes Sleeper fetch + DB upsert +
  //      audit log, then returns 200 with the synced count.
  it('returns 200 with synced count on success', async () => {
    const res = await POST(makePost({ leagueIds: ['999'] }));
    expect(res.status).toBe(200);

    const body = await res.json() as { synced: number; results: unknown[] };
    expect(body.synced).toBe(1);
    expect(body.results).toHaveLength(1);
  });

  // WHY: The body must contain `leagueIds` as a non-empty array. An object
  //      without it (e.g. old `leagueId` singular) should fail with 400.
  it('returns 400 when leagueIds is missing', async () => {
    const res = await POST(makePost({ leagueId: '999' }));
    expect(res.status).toBe(400);
  });

  // WHY: An empty array is meaningless and should be rejected with 400.
  it('returns 400 when leagueIds is an empty array', async () => {
    const res = await POST(makePost({ leagueIds: [] }));
    expect(res.status).toBe(400);
  });

  // WHY: A Sleeper API failure (e.g. invalid league ID) returns 500 so the UI
  //      can tell the user the sync failed.
  it('returns 500 when fetchLeagueData throws', async () => {
    mockFetchLeagueData.mockRejectedValueOnce(new Error('Sleeper 404'));

    const res = await POST(makePost({ leagueIds: ['999'] }));
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Sleeper 404/);
  });

  // WHY: A league with the wrong division count must fail with a message that
  //      references the 2-division requirement so the user knows how to fix it.
  it('returns 500 with division error message for a non-2-division league', async () => {
    mockFetchLeagueData.mockRejectedValueOnce(
      new Error('Expected 2 divisions, league has 3'),
    );

    const res = await POST(makePost({ leagueIds: ['999'] }));
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Expected 2 divisions/);
  });

  // WHY: writeAuditLog must be called once per successfully synced league so
  //      the Activity Log shows an accurate history of sync operations.
  it('calls writeAuditLog once per synced league', async () => {
    await POST(makePost({ leagueIds: ['999'] }));
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith('SYNC', fakeLeagueRecord.id, expect.anything());
  });

  // WHY: Multiple leagueIds should be synced in sequence, returning a count
  //      equal to the number of IDs provided.
  it('syncs multiple leagues and returns correct count', async () => {
    mockFetchLeagueData
      .mockResolvedValueOnce({ ...fakeSyncData, leagueId: 'sleeper-1' } as never)
      .mockResolvedValueOnce({ ...fakeSyncData, leagueId: 'sleeper-2' } as never);
    mockLeagueUpsert
      .mockResolvedValueOnce({ ...fakeLeagueRecord, id: 'db-1' } as never)
      .mockResolvedValueOnce({ ...fakeLeagueRecord, id: 'db-2' } as never);

    const res = await POST(makePost({ leagueIds: ['111', '222'] }));
    expect(res.status).toBe(200);

    const body = await res.json() as { synced: number };
    expect(body.synced).toBe(2);
  });
});
