// tests/unit/lib/audit.test.ts
//
// Tests for the audit log helper in src/lib/audit.ts.
// Mocks @/lib/prisma so no real DB calls are made.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the Prisma module before any imports of the module under test.
jest.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      create: jest.fn(),
    },
  },
}));

import { writeAuditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

const mockCreate = prisma.auditLog.create as jest.MockedFunction<
  typeof prisma.auditLog.create
>;

describe('writeAuditLog()', () => {
  beforeEach(() => {
    // Reset call history and implementations between tests.
    mockCreate.mockReset();
    // By default, resolve successfully.
    mockCreate.mockResolvedValue({} as never);
    // Also spy on console.error so we can assert it is called on failure.
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // WHY: Verifies the correct action, leagueId, and serialised detail are passed
  //      to prisma.auditLog.create. A mismatch would silently record wrong data.
  it('calls prisma.auditLog.create with the correct action and leagueId', async () => {
    await writeAuditLog('SYNC', 'league-1', { teams: 10 });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        action:   'SYNC',
        leagueId: 'league-1',
        // detail must be a JSON string, not a raw object
        detail:   JSON.stringify({ teams: 10 }),
      },
    });
  });

  // WHY: null leagueId must be converted to undefined so Prisma omits the field
  //      rather than writing null to a required foreign-key column.
  it('passes undefined for leagueId when null is provided', async () => {
    await writeAuditLog('GENERATE', null, {});

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ leagueId: undefined }),
    });
  });

  // WHY: The detail field must be JSON-serialised so the audit viewer can
  //      JSON.parse it without needing to handle both object and string formats.
  it('serialises the detail object to a JSON string', async () => {
    const detail = { week: 5, generated: true };
    await writeAuditLog('GENERATE', 'lg-1', detail);

    const call = mockCreate.mock.calls[0][0] as { data: { detail: string } };
    expect(typeof call.data.detail).toBe('string');
    expect(JSON.parse(call.data.detail)).toEqual(detail);
  });

  // WHY: An empty detail object is the default — no argument must not crash.
  it('works when detail is omitted (defaults to empty object)', async () => {
    await expect(writeAuditLog('DELETE', 'lg-1')).resolves.toBeUndefined();
    expect(mockCreate).toHaveBeenCalled();
  });

  // WHY: writeAuditLog is fire-and-forget. If Prisma throws, the function must
  //      NOT rethrow — an audit failure must never fail the primary response.
  it('does not rethrow when prisma.auditLog.create throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB connection lost'));

    // Must resolve without throwing
    await expect(writeAuditLog('SYNC', 'lg-1')).resolves.toBeUndefined();
  });

  // WHY: Even though the error is swallowed, it must be logged so that oncall
  //      engineers can spot audit write failures in server logs.
  it('logs the error to console.error when Prisma throws', async () => {
    const dbError = new Error('DB connection lost');
    mockCreate.mockRejectedValueOnce(dbError);

    await writeAuditLog('EXPORT', 'lg-1');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[audit]'),
      dbError,
    );
  });
});
