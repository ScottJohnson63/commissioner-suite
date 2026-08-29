// tests/app/api/leagues/sync/route.test.ts
//
// Tests for POST /api/leagues/sync — the commissioner guard, body validation,
// and how per-league failures surface. The Sleeper fetch and DB upsert live in
// syncLeague() and are covered in tests/unit/lib/sleeper/sync.test.ts.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/auth', () => ({ auth: jest.fn() }));

jest.mock('@/lib/sleeper/sync', () => ({ syncLeague: jest.fn() }));

// Pass-through: bookkeeping is not what this route is responsible for.
jest.mock('@/lib/syncRun', () => ({
  recordSyncRun: jest.fn((_source: unknown, _trigger: unknown, work: () => Promise<unknown>) => work()),
}));

import { POST } from '@/app/api/leagues/sync/route';
import { auth } from '@/auth';
import { syncLeague } from '@/lib/sleeper/sync';

const mockAuth       = auth       as jest.MockedFunction<typeof auth>;
const mockSyncLeague = syncLeague as jest.MockedFunction<typeof syncLeague>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/leagues/sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function signedInAs(role: string) {
  mockAuth.mockResolvedValue({ user: { role } } as never);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/leagues/sync', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockSyncLeague.mockReset();

    signedInAs('COMMISSIONER');
    mockSyncLeague.mockResolvedValue({
      leagueId: 'db-lg-1',
      sleeperLeagueId: 'sleeper-999',
      teamCount: 10,
    });
  });

  // WHY: This route rewrites League and Team rows that every other page reads,
  //      so a signed-out caller must never reach the Sleeper fetch.
  it('returns 403 when the caller is not signed in', async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await POST(makePost({ leagueIds: ['999'] }));
    expect(res.status).toBe(403);
    expect(mockSyncLeague).not.toHaveBeenCalled();
  });

  // WHY: Members can read the dashboard but must not be able to overwrite the
  //      league record for everyone.
  it('returns 403 for a non-commissioner', async () => {
    signedInAs('MEMBER');

    const res = await POST(makePost({ leagueIds: ['999'] }));
    expect(res.status).toBe(403);
    expect(mockSyncLeague).not.toHaveBeenCalled();
  });

  // WHY: Happy-path — a valid leagueIds array returns 200 with the synced count.
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

  // WHY: A Sleeper API failure (e.g. invalid league ID) returns 500 naming the
  //      league that failed, so the UI can tell the user which one to retry.
  it('returns 500 naming the league that failed', async () => {
    mockSyncLeague.mockRejectedValueOnce(new Error('Sleeper 404'));

    const res = await POST(makePost({ leagueIds: ['999'] }));
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/league 999/);
    expect(body.error).toMatch(/Sleeper 404/);
  });

  // WHY: A league with the wrong division count must fail with a message that
  //      references the 2-division requirement so the user knows how to fix it.
  it('returns 500 with division error message for a non-2-division league', async () => {
    mockSyncLeague.mockRejectedValueOnce(new Error('Expected 2 divisions, league has 3'));

    const res = await POST(makePost({ leagueIds: ['999'] }));
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Expected 2 divisions/);
  });

  // WHY: When the second of two leagues fails, the first league's result must
  //      still come back so the caller knows it does not need re-syncing.
  it('returns partial results when a later league fails', async () => {
    mockSyncLeague
      .mockResolvedValueOnce({ leagueId: 'db-1', sleeperLeagueId: 'sleeper-1', teamCount: 10 })
      .mockRejectedValueOnce(new Error('Sleeper 500'));

    const res = await POST(makePost({ leagueIds: ['111', '222'] }));
    expect(res.status).toBe(500);

    const body = await res.json() as { results: unknown[] };
    expect(body.results).toHaveLength(1);
  });

  // WHY: Multiple leagueIds should be synced in sequence, returning a count
  //      equal to the number of IDs provided.
  it('syncs multiple leagues and returns correct count', async () => {
    const res = await POST(makePost({ leagueIds: ['111', '222'] }));
    expect(res.status).toBe(200);

    const body = await res.json() as { synced: number };
    expect(body.synced).toBe(2);
  });
});
