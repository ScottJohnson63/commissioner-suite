// tests/app/api/audit/route.test.ts
//
// Tests for GET /api/audit.
// Mocks @/lib/prisma and @/auth.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: { findMany: jest.fn() },
  },
}));

jest.mock('@/auth', () => ({ auth: jest.fn() }));

import { GET } from '@/app/api/audit/route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

const mockFindMany = prisma.auditLog.findMany as jest.MockedFunction<typeof prisma.auditLog.findMany>;
const mockAuth     = auth                    as jest.MockedFunction<typeof auth>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGet(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/audit${qs}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeRawLogs = [
  {
    id: 'a1',
    action: 'SYNC',
    leagueId: 'lg1',
    detail: JSON.stringify({ teams: 10 }),
    createdAt: new Date(),
    league: { id: 'lg1', name: 'Test', season: 2025, sleeperLeagueId: '999' },
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/audit', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockAuth.mockResolvedValue({ user: { id: '1', role: 'COMMISSIONER' } } as never);
  });

  // WHY: Authenticated users must receive audit log entries with the detail
  //      field JSON-parsed back to an object (not a raw string).
  it('returns 200 with parsed detail objects', async () => {
    mockFindMany.mockResolvedValueOnce(fakeRawLogs as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{ detail: unknown }>;
    expect(body).toHaveLength(1);
    // detail must be a parsed object, not a JSON string
    expect(typeof body[0].detail).toBe('object');
    expect(body[0].detail).toEqual({ teams: 10 });
  });

  // WHY: Unauthenticated requests must return 401 to prevent public access to
  //      the audit trail.
  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  // WHY: DB failure must produce a 500 with an error message.
  it('returns 500 when Prisma throws', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('DB error'));

    const res = await GET(makeGet());
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/DB error/);
  });

  // WHY: The leagueId query parameter is optional — verifies the route handles
  //      filtering when present and no filter when absent.
  it('passes leagueId filter to Prisma when provided', async () => {
    mockFindMany.mockResolvedValueOnce(fakeRawLogs as never);

    await GET(makeGet('?leagueId=lg1'));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'lg1' } }),
    );
  });

  // WHY: The limit param controls how many entries are returned, capped at 500.
  //      A maliciously large limit must not cause memory issues.
  it('caps the take at 500 when a large limit is requested', async () => {
    mockFindMany.mockResolvedValueOnce([] as never);

    await GET(makeGet('?limit=9999'));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
  });
});
