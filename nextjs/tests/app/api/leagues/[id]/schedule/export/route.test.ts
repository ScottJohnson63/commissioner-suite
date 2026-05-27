// tests/app/api/leagues/[id]/schedule/export/route.test.ts
//
// Tests for GET /api/leagues/[id]/schedule/export.
// Mocks @/lib/prisma and @/lib/audit.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    schedule: { findFirst: jest.fn() },
  },
}));

jest.mock('@/lib/audit', () => ({ writeAuditLog: jest.fn() }));

import { GET } from '@/app/api/leagues/[id]/schedule/export/route';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';

const mockFindFirst = prisma.schedule.findFirst as jest.MockedFunction<typeof prisma.schedule.findFirst>;
const mockAuditLog  = writeAuditLog             as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/leagues/${id}/schedule/export`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeSchedule = {
  id: 'sched-1',
  leagueId: 'lg1',
  season: 2025,
  matchups: [
    { week: 1, type: 'division',       homeTeam: { name: 'Team A' }, awayTeam: { name: 'Team B' } },
    { week: 1, type: 'cross-division', homeTeam: { name: 'Team C' }, awayTeam: { name: 'Team D' } },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/leagues/[id]/schedule/export', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockAuditLog.mockReset();
    mockAuditLog.mockResolvedValue(undefined);
  });

  // WHY: A valid schedule must be exported as CSV with the correct Content-Type
  //      header so the browser triggers a file download.
  it('returns 200 with text/csv content-type when a schedule exists', async () => {
    mockFindFirst.mockResolvedValueOnce(fakeSchedule as never);

    const res = await GET(makeReq('lg1'), makeParams('lg1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
  });

  // WHY: The CSV body must include a header row and data rows. Verifying the
  //      column headers ensures the downstream CSV parser gets the right shape.
  it('includes a CSV header row (week,home,away,type)', async () => {
    mockFindFirst.mockResolvedValueOnce(fakeSchedule as never);

    const res = await GET(makeReq('lg1'), makeParams('lg1'));
    const text = await res.text();
    const lines = text.split('\n');

    // First line is the header
    expect(lines[0]).toBe('week,home,away,type');
  });

  // WHY: Each matchup in the schedule must appear as a data row in the CSV
  //      with the correct team names and matchup type.
  it('includes one data row per matchup with correct values', async () => {
    mockFindFirst.mockResolvedValueOnce(fakeSchedule as never);

    const res = await GET(makeReq('lg1'), makeParams('lg1'));
    const text = await res.text();
    const lines = text.split('\n');

    // 1 header + 2 matchup rows
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('1,Team A,Team B,division');
  });

  // WHY: Content-Disposition must be set so the browser names the file
  //      correctly when it prompts the user to save it.
  it('sets Content-Disposition attachment header with the season', async () => {
    mockFindFirst.mockResolvedValueOnce(fakeSchedule as never);

    const res = await GET(makeReq('lg1'), makeParams('lg1'));
    const disposition = res.headers.get('content-disposition');

    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/2025/);
  });

  // WHY: No schedule found must return 404 so the UI knows there is nothing
  //      to download and can prompt the user to generate one first.
  it('returns 404 when no schedule exists', async () => {
    mockFindFirst.mockResolvedValueOnce(null as never);

    const res = await GET(makeReq('lg1'), makeParams('lg1'));
    expect(res.status).toBe(404);
  });

  // WHY: An EXPORT audit log entry must be written on every successful export
  //      so the Activity Log shows download history.
  it('writes an EXPORT audit log entry', async () => {
    mockFindFirst.mockResolvedValueOnce(fakeSchedule as never);

    await GET(makeReq('lg1'), makeParams('lg1'));

    expect(mockAuditLog).toHaveBeenCalledWith(
      'EXPORT',
      'lg1',
      expect.objectContaining({ scheduleId: 'sched-1' }),
    );
  });
});
