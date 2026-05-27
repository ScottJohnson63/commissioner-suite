// tests/app/api/assoc/divisions/route.test.ts
//
// Tests for POST /api/assoc/divisions.
// Mocks @/lib/prisma and @/lib/audit.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: jest.fn() },
    team:   { updateMany: jest.fn() },
  },
}));

jest.mock('@/lib/audit', () => ({ writeAuditLog: jest.fn() }));

import { POST } from '@/app/api/assoc/divisions/route';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';

const mockLeagueFindUnique = prisma.league.findUnique as jest.MockedFunction<typeof prisma.league.findUnique>;
const mockTeamUpdateMany   = prisma.team.updateMany   as jest.MockedFunction<typeof prisma.team.updateMany>;
const mockAuditLog         = writeAuditLog            as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/assoc/divisions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const fakeStandings = [
  { rosterId: 1, name: 'Team A', rank: 1, wins: 10, losses: 3, pointsFor: 1500, pointsAgainst: 1200, division: 1 },
  { rosterId: 2, name: 'Team B', rank: 2, wins: 9,  losses: 4, pointsFor: 1400, pointsAgainst: 1100, division: 2 },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/assoc/divisions', () => {
  beforeEach(() => {
    mockLeagueFindUnique.mockReset();
    mockTeamUpdateMany.mockReset();
    mockAuditLog.mockReset();

    mockLeagueFindUnique.mockResolvedValue({ id: 'lg1', name: 'Test', season: 2025 } as never);
    mockTeamUpdateMany.mockResolvedValue({ count: 1 } as never);
    mockAuditLog.mockResolvedValue(undefined);
  });

  // WHY: Happy path — a valid leagueId and standings array triggers updateMany
  //      for each team and returns the updated count.
  it('returns 200 with updated count on success', async () => {
    const res = await POST(makePost({ leagueId: 'lg1', standings: fakeStandings }));
    expect(res.status).toBe(200);

    const body = await res.json() as { updated: number };
    expect(body.updated).toBe(2);
  });

  // WHY: leagueId is required. Missing it must return 400 before any DB calls.
  it('returns 400 when leagueId is missing', async () => {
    const res = await POST(makePost({ standings: fakeStandings }));
    expect(res.status).toBe(400);
    expect(mockTeamUpdateMany).not.toHaveBeenCalled();
  });

  // WHY: An empty standings array is meaningless. Reject it early.
  it('returns 400 when standings is an empty array', async () => {
    const res = await POST(makePost({ leagueId: 'lg1', standings: [] }));
    expect(res.status).toBe(400);
  });

  // WHY: If the league record doesn't exist in the DB, return 404 rather than
  //      updating teams that belong to a phantom league.
  it('returns 404 when the league is not found', async () => {
    mockLeagueFindUnique.mockResolvedValueOnce(null as never);

    const res = await POST(makePost({ leagueId: 'nonexistent', standings: fakeStandings }));
    expect(res.status).toBe(404);
    expect(mockTeamUpdateMany).not.toHaveBeenCalled();
  });

  // WHY: One updateMany call must be made per standing entry so each team's
  //      divisionId is set correctly.
  it('calls updateMany once per standing entry', async () => {
    await POST(makePost({ leagueId: 'lg1', standings: fakeStandings }));

    expect(mockTeamUpdateMany).toHaveBeenCalledTimes(2);
  });

  // WHY: writeAuditLog must be called with the GENERATE action so the division
  //      assignment appears in the Activity Log.
  it('writes an audit log entry on success', async () => {
    await POST(makePost({ leagueId: 'lg1', standings: fakeStandings }));

    expect(mockAuditLog).toHaveBeenCalledWith(
      'GENERATE',
      'lg1',
      expect.objectContaining({ type: 'divisions' }),
    );
  });
});
