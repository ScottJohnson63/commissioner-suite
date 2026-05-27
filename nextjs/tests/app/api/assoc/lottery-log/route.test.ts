// tests/app/api/assoc/lottery-log/route.test.ts
//
// POST /api/assoc/lottery-log
//
// Records the outcome of a draft lottery simulation in the audit log.
// Each lottery run — including re-runs — is permanently logged for transparency.
//
// Mocks: @/lib/audit (writeAuditLog)

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/audit', () => ({
  writeAuditLog: jest.fn(),
}));

import { POST } from '@/app/api/assoc/lottery-log/route';
import { writeAuditLog } from '@/lib/audit';

const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: object): NextRequest {
  return new NextRequest('http://localhost/api/assoc/lottery-log', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// A valid lottery result record matching the LotteryResult interface.
const validResult = {
  rosterId: 101,
  name: 'Alpha Squad',
  ownerName: 'Alice',
  prevRank: 8,
  count: 125000,
  pick: 1,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/assoc/lottery-log', () => {
  beforeEach(() => {
    mockWriteAuditLog.mockReset();
    mockWriteAuditLog.mockResolvedValue(undefined);
  });

  // WHY: Missing leagueId means the audit entry can't be associated with a
  //      league — must reject with 400 before touching the DB.
  it('returns 400 when leagueId is missing', async () => {
    const res = await POST(makeReq({ results: [validResult] }));
    expect(res.status).toBe(400);
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  // WHY: results must be an array — the route maps over it to build the audit
  //      payload. A non-array would crash the .map() call.
  it('returns 400 when results is missing', async () => {
    const res = await POST(makeReq({ leagueId: 'l1' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when results is not an array', async () => {
    const res = await POST(makeReq({ leagueId: 'l1', results: null }));
    expect(res.status).toBe(400);
  });

  // WHY: Successful submission must write a single audit entry with the correct
  //      leagueId and type = 'lottery'.
  it('writes a lottery audit entry and returns { logged: true }', async () => {
    const res = await POST(makeReq({ leagueId: 'league-1', results: [validResult] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.logged).toBe(true);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      'GENERATE',
      'league-1',
      expect.objectContaining({ type: 'lottery', totalDraws: 1_000_000 }),
    );
  });

  // WHY: The `rerun` flag must default to false when not supplied — a fresh
  //      lottery run is not a re-run. This distinction matters for audit display.
  it('defaults rerun to false when not provided', async () => {
    await POST(makeReq({ leagueId: 'league-1', results: [validResult] }));

    const payload = mockWriteAuditLog.mock.calls[0][2] as { rerun: boolean };
    expect(payload.rerun).toBe(false);
  });

  // WHY: When the commissioner explicitly re-runs the lottery, `rerun: true`
  //      must be forwarded to the audit log as-is for full traceability.
  it('forwards rerun: true when supplied', async () => {
    await POST(makeReq({ leagueId: 'league-1', results: [validResult], rerun: true }));

    const payload = mockWriteAuditLog.mock.calls[0][2] as { rerun: boolean };
    expect(payload.rerun).toBe(true);
  });

  // WHY: All team results must appear in the audit log so the full ticket
  //      distribution is auditable — not just the top picks.
  it('includes all submitted results in the audit log picks array', async () => {
    const results = [
      validResult,
      { ...validResult, rosterId: 102, name: 'Beta Force', count: 100000, pick: 2 },
    ];
    await POST(makeReq({ leagueId: 'league-1', results }));

    const payload = mockWriteAuditLog.mock.calls[0][2] as { picks: unknown[] };
    expect(payload.picks).toHaveLength(2);
  });
});
