// tests/app/api/sync/run/route.test.ts
//
// Tests for POST /api/sync/run — the commissioner gate, the split between
// in-process league sync and GitHub workflow dispatch, and the `force` input
// rule that keeps the destructive season reset from firing on a button click.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { league: { findMany: jest.fn(), findUnique: jest.fn() } },
}));
jest.mock('@/lib/sleeper/sync', () => ({ syncLeague: jest.fn() }));
jest.mock('@/lib/syncRun', () => ({
  recordSyncRun: jest.fn((_s: unknown, _t: unknown, work: () => Promise<unknown>) => work()),
}));

import { POST } from '@/app/api/sync/run/route';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { syncLeague } from '@/lib/sleeper/sync';

const mockAuth        = auth as jest.MockedFunction<typeof auth>;
const mockLeagueFind  = prisma.league.findMany as jest.MockedFunction<typeof prisma.league.findMany>;
const mockSyncLeague  = syncLeague as jest.MockedFunction<typeof syncLeague>;
const mockLeagueOne   = prisma.league.findUnique as jest.MockedFunction<typeof prisma.league.findUnique>;

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/sync/run', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** Captures the outgoing GitHub dispatch so its body can be asserted. */
function stubGitHub(ok = true) {
  const fetchMock = jest.fn(async () =>
    ok
      ? new Response(null, { status: 204 })
      : new Response('bad credentials', { status: 401 }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('POST /api/sync/run', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockLeagueFind.mockReset();
    mockLeagueOne.mockReset();
    mockSyncLeague.mockReset();

    mockAuth.mockResolvedValue({ user: { role: 'COMMISSIONER' } } as never);
    mockLeagueFind.mockResolvedValue([{ sleeperLeagueId: '999' }] as never);
    mockSyncLeague.mockResolvedValue({
      leagueId: 'db-1', sleeperLeagueId: '999', teamCount: 10,
    });

    process.env.GITHUB_SYNC_TOKEN = 'tok';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  // WHY: This endpoint can dispatch a job that truncates stat tables, so the
  //      role check is the only thing standing between a member and that job.
  it('returns 403 for a non-commissioner', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'MEMBER' } } as never);
    const res = await POST(post({ source: 'NFL_WEEKLY' }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when signed out', async () => {
    mockAuth.mockResolvedValue(null as never);
    expect((await POST(post({ source: 'NFL_WEEKLY' }))).status).toBe(403);
  });

  it('returns 400 for an unknown source', async () => {
    expect((await POST(post({ source: 'NOT_A_FEED' }))).status).toBe(400);
  });

  it('returns 400 when source is missing', async () => {
    expect((await POST(post({}))).status).toBe(400);
  });

  // WHY: The league sync is cheap enough to run in the request, so it should
  //      report a real synced count rather than queueing anything.
  it('runs the league sync in-process', async () => {
    const res = await POST(post({ source: 'SLEEPER_LEAGUES' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ synced: 1, results: expect.any(Array) });
    expect(mockSyncLeague).toHaveBeenCalledWith('999');
  });

  it('returns 400 when no leagues are registered', async () => {
    mockLeagueFind.mockResolvedValue([] as never);
    expect((await POST(post({ source: 'SLEEPER_LEAGUES' }))).status).toBe(400);
  });

  // WHY: FORCE=true is what stops a deliberate mid-week run from being skipped
  //      by the script's season-window guard.
  it('sends force=true when dispatching a season-guarded job', async () => {
    const fetchMock = stubGitHub();

    const res = await POST(post({ source: 'NFL_WEEKLY' }));
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/actions/workflows/sync_nfl_weekly.yml/dispatches');
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'main', inputs: { force: 'true' } });
  });

  // WHY: Forcing this job would truncate and reload three seasons of stats.
  it('omits force when dispatching the season reset', async () => {
    const fetchMock = stubGitHub();

    await POST(post({ source: 'NFL_SEASON_RESET' }));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'main' });
  });

  // WHY: GitHub rejects the whole request with a 422 if a workflow does not
  //      declare the input being passed.
  it('omits force for a workflow that declares no inputs', async () => {
    const fetchMock = stubGitHub();

    await POST(post({ source: 'SLEEPER_RANKINGS' }));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'main' });
  });

  // WHY: Reporting success when the dispatch never happened would leave the
  //      commissioner waiting for data that is not coming.
  it('surfaces a GitHub rejection rather than claiming success', async () => {
    stubGitHub(false);

    const res = await POST(post({ source: 'NFL_WEEKLY' }));
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toMatch(/401/);
  });

  it('explains what is missing when GitHub credentials are unset', async () => {
    delete process.env.GITHUB_SYNC_TOKEN;

    const res = await POST(post({ source: 'NFL_WEEKLY' }));
    expect(res.status).toBe(501);
    expect((await res.json() as { error: string }).error).toMatch(/GITHUB_SYNC_TOKEN/);
  });

  // ── League scoping ────────────────────────────────────────────────────────

  // WHY: The League table is the allowlist. Dispatching an unregistered id
  //      would let a commissioner pull data for a league the app never adopted.
  it('refuses a league id that is not registered', async () => {
    mockLeagueOne.mockResolvedValue(null as never);

    const res = await POST(post({ source: 'SLEEPER_LEAGUES', leagueId: '999' }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/not registered/);
    expect(mockSyncLeague).not.toHaveBeenCalled();
  });

  it('syncs only the selected league in-process', async () => {
    mockLeagueOne.mockResolvedValue({ id: 'db-1' } as never);
    mockLeagueFind.mockResolvedValue([{ sleeperLeagueId: '111' }] as never);
    mockSyncLeague.mockResolvedValue({ leagueId: 'db-1', sleeperLeagueId: '111', teamCount: 10 } as never);

    const res = await POST(post({ source: 'SLEEPER_LEAGUES', leagueId: '111' }));

    expect(res.status).toBe(200);
    expect(mockLeagueFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sleeperLeagueId: '111' } }),
    );
    expect(mockSyncLeague).toHaveBeenCalledTimes(1);
    expect(mockSyncLeague).toHaveBeenCalledWith('111');
  });

  // WHY: Omitting the id is how the "sync everything" path is expressed, and
  //      it must keep working for callers that do not pass one.
  it('sweeps every league when no league id is given', async () => {
    mockLeagueFind.mockResolvedValue([
      { sleeperLeagueId: '111' }, { sleeperLeagueId: '222' },
    ] as never);
    mockSyncLeague.mockResolvedValue({ leagueId: 'db', sleeperLeagueId: 'x', teamCount: 10 } as never);

    await POST(post({ source: 'SLEEPER_LEAGUES' }));

    expect(mockLeagueFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
    expect(mockSyncLeague).toHaveBeenCalledTimes(2);
  });

  it('passes league_id to a league-scoped workflow dispatch', async () => {
    const fetchMock = stubGitHub(true);
    mockLeagueOne.mockResolvedValue({ id: 'db-1' } as never);

    await POST(post({ source: 'SLEEPER_SCORES', leagueId: '111' }));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).inputs).toEqual({ force: 'true', league_id: '111' });
  });

  // WHY: The nflverse feeds pull NFL-wide data. Sending league_id would be
  //      rejected by GitHub as an undeclared input, and would mean nothing.
  it('drops the league id for a global feed', async () => {
    const fetchMock = stubGitHub(true);

    await POST(post({ source: 'NFL_WEEKLY', leagueId: '111' }));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).inputs).toEqual({ force: 'true' });
    expect(mockLeagueOne).not.toHaveBeenCalled();
  });
});