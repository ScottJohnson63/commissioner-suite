// tests/app/api/matchups/[id]/route.test.ts
//
// PATCH /api/matchups/{id}
//
// Allows commissioners to correct matchup records after schedule generation.
// The route delegates entirely to prisma.matchup.update — its only logic is
// catching the "not found" Prisma error and returning 404.
//
// Mocks: @/lib/prisma (matchup.update)

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    matchup: {
      update: jest.fn(),
    },
  },
}));

import { PATCH } from '@/app/api/matchups/[id]/route';
import { prisma } from '@/lib/prisma';

const mockUpdate = prisma.matchup.update as jest.MockedFunction<typeof prisma.matchup.update>;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Builds a PATCH request with a JSON body and the matchup id path segment.
function makeReq(body: object): NextRequest {
  return new NextRequest('http://localhost/api/matchups/matchup-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// NextJS dynamic params are now Promises — wrap the id in one.
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/matchups/[id]', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
  });

  // WHY: A successful update should return the full updated matchup record.
  //      The route proxies prisma directly — what prisma returns, the route returns.
  it('returns 200 with the updated matchup on success', async () => {
    const updated = { id: 'matchup-1', homeTeamId: 'team-a', awayTeamId: 'team-b', week: 3 };
    mockUpdate.mockResolvedValueOnce(updated as never);

    const res = await PATCH(makeReq({ week: 3 }), makeParams('matchup-1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject(updated);
  });

  // WHY: The route passes only the fields present in the request body to the
  //      prisma update call — missing fields must NOT be sent as undefined,
  //      which would accidentally clear them in the DB.
  it('forwards only the provided fields to prisma.matchup.update', async () => {
    mockUpdate.mockResolvedValueOnce({ id: 'matchup-1', week: 7 } as never);

    await PATCH(makeReq({ week: 7 }), makeParams('matchup-1'));

    // The data object sent to prisma must only contain `week`, not homeTeamId/awayTeamId.
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'matchup-1' },
      data: { week: 7 },
    });
  });

  // WHY: When prisma.matchup.update throws (Prisma P2025 — record not found),
  //      the route must return 404, not a 500. The catch block converts the
  //      throw to a structured JSON error response.
  it('returns 404 when the matchup does not exist', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('Record not found'));

    const res = await PATCH(makeReq({ week: 5 }), makeParams('missing-id'));

    expect(res.status).toBe(404);
  });

  // WHY: All three editable fields can be sent together in one request.
  //      prisma should receive them all, and the response should reflect them.
  it('accepts a full body with homeTeamId, awayTeamId, and week', async () => {
    const body = { homeTeamId: 'team-a', awayTeamId: 'team-b', week: 10 };
    mockUpdate.mockResolvedValueOnce({ id: 'matchup-1', ...body } as never);

    const res = await PATCH(makeReq(body), makeParams('matchup-1'));

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'matchup-1' },
      data: body,
    });
  });
});
