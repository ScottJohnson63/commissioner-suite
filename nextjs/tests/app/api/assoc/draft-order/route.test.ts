// tests/app/api/assoc/draft-order/route.test.ts
//
// POST /api/assoc/draft-order
//
// Records the final draft order in the audit log. No DB table stores draft
// order — it is reconstructed from the audit log whenever displayed.
//
// Mocks: @/lib/audit (writeAuditLog)

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/audit', () => ({
  writeAuditLog: jest.fn(),
}));

import { POST } from '@/app/api/assoc/draft-order/route';
import { writeAuditLog } from '@/lib/audit';

const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: object): NextRequest {
  return new NextRequest('http://localhost/api/assoc/draft-order', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// A valid draft pick record matching the DraftPick interface.
const validPick = {
  pick: 1,
  rosterId: 101,
  name: 'Alpha Squad',
  ownerName: 'Alice',
  source: 'lottery' as const,
  prevRank: 8,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/assoc/draft-order', () => {
  beforeEach(() => {
    mockWriteAuditLog.mockReset();
    // Default: writeAuditLog resolves without error.
    mockWriteAuditLog.mockResolvedValue(undefined);
  });

  // WHY: A request without leagueId cannot be attributed to any league in the
  //      audit log — must fail with 400 rather than write a corrupt record.
  it('returns 400 when leagueId is missing', async () => {
    const res = await POST(makeReq({ draftOrder: [validPick] }));
    expect(res.status).toBe(400);
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  // WHY: A non-array draftOrder (e.g. null or a string) would crash the Array
  //      iteration in the audit log builder — must be caught at the boundary.
  it('returns 400 when draftOrder is missing', async () => {
    const res = await POST(makeReq({ leagueId: 'l1' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when draftOrder is not an array', async () => {
    const res = await POST(makeReq({ leagueId: 'l1', draftOrder: null }));
    expect(res.status).toBe(400);
  });

  // WHY: The happy path must write exactly one audit entry with the correct
  //      leagueId, action type, and all pick data.
  it('writes an audit log and returns { logged: true } on success', async () => {
    const res = await POST(makeReq({ leagueId: 'league-1', draftOrder: [validPick] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.logged).toBe(true);
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      'GENERATE',
      'league-1',
      expect.objectContaining({ type: 'draft_order' }),
    );
  });

  // WHY: Every pick submitted should appear in the audit log — the route must
  //      map the full draftOrder array into the log payload without omissions.
  it('includes all submitted picks in the audit log payload', async () => {
    const picks = [
      { ...validPick, pick: 1 },
      { ...validPick, pick: 2, rosterId: 102, name: 'Beta Force', source: 'standings' as const },
    ];
    await POST(makeReq({ leagueId: 'league-1', draftOrder: picks }));

    const logPayload = (mockWriteAuditLog.mock.calls[0][2] as { picks: unknown[] });
    expect(logPayload.picks).toHaveLength(2);
  });
});
