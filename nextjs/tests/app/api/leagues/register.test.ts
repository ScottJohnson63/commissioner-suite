// tests/app/api/leagues/register.test.ts
//
// POST /api/leagues and DELETE /api/leagues/[id] — the commissioner's allowlist.
//
// The League table decides what the whole app is about: members only ever see
// the intersection of it with their own Sleeper leagues, and the sync jobs only
// touch leagues listed in it. So the gate on writing to it, and the validation
// that stops junk getting in, are the things worth pinning down here.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: jest.fn(), delete: jest.fn() },
    schedule: { findMany: jest.fn(), deleteMany: jest.fn() },
    matchup: { deleteMany: jest.fn() },
    sleeperRanking: { deleteMany: jest.fn() },
    team: { deleteMany: jest.fn() },
  },
}));
jest.mock('@/lib/sleeper/sync', () => ({ syncLeague: jest.fn() }));
jest.mock('@/lib/syncRun', () => ({
  recordSyncRun: jest.fn((_s: unknown, _t: unknown, work: () => Promise<unknown>) => work()),
}));

import { POST } from '@/app/api/leagues/route';
import { DELETE } from '@/app/api/leagues/[id]/route';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { syncLeague } from '@/lib/sleeper/sync';
import { recordSyncRun } from '@/lib/syncRun';

const mockAuth       = auth as jest.MockedFunction<typeof auth>;
const mockFindUnique = prisma.league.findUnique as jest.MockedFunction<typeof prisma.league.findUnique>;
const mockDelete     = prisma.league.delete as jest.MockedFunction<typeof prisma.league.delete>;
const mockSchedFind  = prisma.schedule.findMany as jest.MockedFunction<typeof prisma.schedule.findMany>;
const mockMatchupDel = prisma.matchup.deleteMany as jest.MockedFunction<typeof prisma.matchup.deleteMany>;
const mockSyncLeague = syncLeague as jest.MockedFunction<typeof syncLeague>;
const mockRecord     = recordSyncRun as jest.MockedFunction<typeof recordSyncRun>;

const COMMISSIONER = { user: { role: 'COMMISSIONER' } };
const MEMBER = { user: { role: 'MEMBER' } };

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/leagues', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const delReq = () => new NextRequest('http://localhost/api/leagues/lg1', { method: 'DELETE' });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/leagues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue(COMMISSIONER as never);
    mockFindUnique.mockResolvedValue(null as never);
    mockSyncLeague.mockResolvedValue(
      { leagueId: 'lg1', sleeperLeagueId: '111111', teamCount: 10 } as never,
    );
  });

  // WHY: Registering a league is what makes it visible to every member, so it
  //      is commissioner-only in the same way the sync buttons are.
  it('refuses a non-commissioner', async () => {
    mockAuth.mockResolvedValue(MEMBER as never);
    const res = await POST(post({ sleeperLeagueId: '111111' }));
    expect(res.status).toBe(403);
    expect(mockSyncLeague).not.toHaveBeenCalled();
  });

  it('requires a league id', async () => {
    expect((await POST(post({}))).status).toBe(400);
  });

  // WHY: Sleeper league ids are numeric. Rejecting anything else here keeps a
  //      pasted URL or a display name from becoming an outbound request.
  it.each(['not-a-number', 'https://sleeper.com/leagues/123', '12', ''])(
    'rejects %p without calling Sleeper',
    async (value) => {
      const res = await POST(post({ sleeperLeagueId: value }));
      expect(res.status).toBe(400);
      expect(mockSyncLeague).not.toHaveBeenCalled();
    },
  );

  it('rejects a league that is already registered', async () => {
    mockFindUnique.mockResolvedValue({ id: 'lg1' } as never);
    const res = await POST(post({ sleeperLeagueId: '111111' }));
    expect(res.status).toBe(409);
    expect(mockSyncLeague).not.toHaveBeenCalled();
  });

  // WHY: A row with no teams would appear in the selector and then render an
  //      empty app, so registering has to pull the league in as well.
  it('syncs the league as part of registering it', async () => {
    await POST(post({ sleeperLeagueId: '111111' }));
    expect(mockSyncLeague).toHaveBeenCalledWith('111111');
  });

  it('records the run against the league it registered', async () => {
    await POST(post({ sleeperLeagueId: '111111' }));
    expect(mockRecord).toHaveBeenCalledWith(
      'SLEEPER_LEAGUES', 'manual', expect.any(Function), '111111',
    );
  });

  // WHY: Sleeper 404s and the 2-division rule are both the commissioner's to
  //      fix — a generic 500 would tell them nothing about what to change.
  it('passes the failure reason through', async () => {
    mockSyncLeague.mockRejectedValue(new Error('Expected 2 divisions, league has 1') as never);

    const res = await POST(post({ sleeperLeagueId: '111111' }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/Expected 2 divisions/);
  });
});

describe('DELETE /api/leagues/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue(COMMISSIONER as never);
    mockFindUnique.mockResolvedValue(
      { id: 'lg1', name: 'Alpha', sleeperLeagueId: '111111' } as never,
    );
    mockSchedFind.mockResolvedValue([] as never);
    mockDelete.mockResolvedValue({ id: 'lg1' } as never);
  });

  it('refuses a non-commissioner', async () => {
    mockAuth.mockResolvedValue(MEMBER as never);
    expect((await DELETE(delReq(), params('lg1'))).status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('404s an unknown league', async () => {
    mockFindUnique.mockResolvedValue(null as never);
    expect((await DELETE(delReq(), params('nope'))).status).toBe(404);
  });

  // WHY: Matchup rows point at Schedule and Team. Deleting the league before
  //      them would leave rows referencing a parent that no longer exists.
  it('clears matchups before the schedules they belong to', async () => {
    mockSchedFind.mockResolvedValue([{ id: 's1' }, { id: 's2' }] as never);

    await DELETE(delReq(), params('lg1'));

    expect(mockMatchupDel).toHaveBeenCalledWith({
      where: { scheduleId: { in: ['s1', 's2'] } },
    });
    const matchupOrder = mockMatchupDel.mock.invocationCallOrder[0];
    const leagueOrder = mockDelete.mock.invocationCallOrder[0];
    expect(matchupOrder).toBeLessThan(leagueOrder);
  });

  // WHY: deleteMany with an empty `in` list is a pointless round trip on the
  //      common path where a league never had a schedule generated.
  it('skips the matchup delete when there are no schedules', async () => {
    await DELETE(delReq(), params('lg1'));
    expect(mockMatchupDel).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('reports which league was removed', async () => {
    const res = await DELETE(delReq(), params('lg1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: '111111', name: 'Alpha' });
  });
});
