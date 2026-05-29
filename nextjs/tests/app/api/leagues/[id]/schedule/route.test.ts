// tests/app/api/leagues/[id]/schedule/route.test.ts
//
// Tests for GET + POST /api/leagues/[id]/schedule.
// Mocks @/lib/prisma, @/lib/scheduler/engine, and @/lib/audit.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    league:   { findFirst: jest.fn() },
    schedule: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
  },
}));

jest.mock('@/lib/scheduler/engine', () => ({
  generateSchedule: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({ writeAuditLog: jest.fn() }));

jest.mock('@/lib/sleeper/sync', () => ({
  fetchLeagueData: jest.fn(),
}));

import { GET, POST } from '@/app/api/leagues/[id]/schedule/route';
import { fetchLeagueData } from '@/lib/sleeper/sync';
import { prisma } from '@/lib/prisma';
import { generateSchedule } from '@/lib/scheduler/engine';
import { writeAuditLog } from '@/lib/audit';
import { ScheduleError } from '@/lib/scheduler/types';

const mockLeagueFindFirst   = prisma.league.findFirst as jest.MockedFunction<typeof prisma.league.findFirst>;
const mockFetchLeagueData   = fetchLeagueData         as jest.MockedFunction<typeof fetchLeagueData>;
const mockScheduleFindFirst = prisma.schedule.findFirst as jest.MockedFunction<typeof prisma.schedule.findFirst>;
const mockScheduleCreate    = prisma.schedule.create    as jest.MockedFunction<typeof prisma.schedule.create>;
const mockGenerateSchedule  = generateSchedule          as jest.MockedFunction<typeof generateSchedule>;
const mockAuditLog          = writeAuditLog             as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(id: string, method = 'GET'): NextRequest {
  return new NextRequest(`http://localhost/api/leagues/${id}/schedule`, { method });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// A league with exactly 10 teams in two divisions (required by the scheduler).
const fakeLeague = {
  id:              'lg1',
  name:            'Test League',
  season:          2025,
  sleeperLeagueId: 'sleeper-999',
  teams: Array.from({ length: 10 }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    divisionId: i < 5 ? 0 : 1,
  })),
};

// A minimal saved schedule record (as returned by prisma.schedule.create).
const fakeSavedSchedule = {
  id: 'sched-1',
  leagueId: 'lg1',
  season: 2025,
  seed: 12345,
  matchups: [
    { week: 1, homeTeamId: 't1', awayTeamId: 't2', type: 'division',
      homeTeam: { name: 'Team 1' }, awayTeam: { name: 'Team 2' } },
  ],
};

// What generateSchedule returns (a proper Schedule object).
const fakeSchedule = {
  leagueId: 'sleeper-999',
  season: 2025,
  generatedAt: new Date(),
  weeks: [
    {
      week: 1,
      matchups: [
        { home: 't1', away: 't6',  type: 'cross-division' },
        { home: 't2', away: 't7',  type: 'cross-division' },
        { home: 't3', away: 't8',  type: 'cross-division' },
        { home: 't4', away: 't9',  type: 'cross-division' },
        { home: 't5', away: 't10', type: 'cross-division' },
      ],
    },
  ],
};

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/leagues/[id]/schedule', () => {
  beforeEach(() => {
    mockLeagueFindFirst.mockReset();
    mockScheduleFindFirst.mockReset();
    mockLeagueFindFirst.mockResolvedValue(fakeLeague as never);
  });

  // WHY: If a schedule exists, return it with 200 so the UI can display the grid.
  it('returns 200 with schedule data when a schedule exists', async () => {
    mockScheduleFindFirst.mockResolvedValueOnce(fakeSavedSchedule as never);

    const res = await GET(makeReq('lg1'), makeParams('lg1'));
    expect(res.status).toBe(200);

    const body = await res.json() as typeof fakeSavedSchedule;
    expect(body.id).toBe('sched-1');
  });

  // WHY: When no schedule has been generated yet, return 404 so the UI can
  //      show the "Generate Schedule" prompt instead of an empty table.
  it('returns 404 when no schedule exists for the league', async () => {
    mockScheduleFindFirst.mockResolvedValueOnce(null as never);

    const res = await GET(makeReq('lg1'), makeParams('lg1'));
    expect(res.status).toBe(404);
  });
});

// ── POST tests ────────────────────────────────────────────────────────────────

describe('POST /api/leagues/[id]/schedule', () => {
  beforeEach(() => {
    mockLeagueFindFirst.mockReset();
    mockFetchLeagueData.mockReset();
    mockScheduleCreate.mockReset();
    mockGenerateSchedule.mockReset();
    mockAuditLog.mockReset();

    mockLeagueFindFirst.mockResolvedValue(fakeLeague as never);
    mockGenerateSchedule.mockReturnValue(fakeSchedule as never);
    mockScheduleCreate.mockResolvedValue(fakeSavedSchedule as never);
    mockAuditLog.mockResolvedValue(undefined);
  });

  // WHY: Happy path — valid league triggers schedule generation, DB save,
  //      and audit log, returning the schedule ID and matchup count.
  it('returns 200 with scheduleId on success', async () => {
    const res = await POST(makeReq('lg1', 'POST'), makeParams('lg1'));
    expect(res.status).toBe(200);

    const body = await res.json() as { scheduleId: string; matchupCount: number };
    expect(body.scheduleId).toBe('sched-1');
    expect(mockGenerateSchedule).toHaveBeenCalledTimes(1);
  });

  // WHY: When the league isn't in the DB the route tries to sync from Sleeper.
  //      If Sleeper returns an error (e.g. bad league ID), return 500.
  it('returns 500 when the league is not found and Sleeper sync fails', async () => {
    mockLeagueFindFirst.mockResolvedValueOnce(null as never);
    mockFetchLeagueData.mockRejectedValueOnce(new Error('Sleeper 404') as never);

    const res = await POST(makeReq('lg-bad', 'POST'), makeParams('lg-bad'));
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Failed to sync league from Sleeper/);
  });

  // WHY: If the team count is wrong (not 10), generateSchedule throws a
  //      ScheduleError which the route must catch and return as a 500.
  it('returns 500 when generateSchedule throws a ScheduleError', async () => {
    mockGenerateSchedule.mockImplementationOnce(() => {
      throw new ScheduleError('Expected 10 teams, got 9');
    });

    const res = await POST(makeReq('lg1', 'POST'), makeParams('lg1'));
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Expected 10 teams/);
  });

  // WHY: An audit log must be written on every successful generation so
  //      the commissioner can see when schedules were created.
  it('writes an audit log with GENERATE action on success', async () => {
    await POST(makeReq('lg1', 'POST'), makeParams('lg1'));

    expect(mockAuditLog).toHaveBeenCalledWith(
      'GENERATE',
      'lg1',
      expect.objectContaining({ type: 'schedule' }),
    );
  });
});
