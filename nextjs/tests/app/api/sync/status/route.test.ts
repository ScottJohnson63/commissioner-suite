// tests/app/api/sync/status/route.test.ts
//
// Tests for GET /api/sync/status — the auth gate, and how SyncRun rows are
// collapsed to one "last run" per feed.
//
// The clock is frozen. "Overdue" is measured from the last time a cron should
// have fired, so a test that asks whether a never-run weekly feed is overdue is
// really asking what day it is: NFL_WEEKLY fires Tuesdays at 08:00 UTC with a
// six-hour grace, so against a live clock it passed six days a week and failed
// every Tuesday morning.

import { describe, it, expect, afterAll, beforeEach, jest } from '@jest/globals';

jest.mock('@/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { syncRun: { findMany: jest.fn() } } }));

import { GET } from '@/app/api/sync/status/route';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { SYNC_JOBS } from '@/lib/syncSchedule';

// A Thursday, comfortably past Tuesday's fire and well inside the season, so
// every cadence in SYNC_JOBS has a previous run to be measured against.
const FROZEN_NOW = new Date('2026-09-10T12:00:00Z');
jest.useFakeTimers({ now: FROZEN_NOW, doNotFake: ['performance'] });
afterAll(() => { jest.useRealTimers(); });

const mockAuth    = auth as jest.MockedFunction<typeof auth>;
const mockFindMany = prisma.syncRun.findMany as jest.MockedFunction<typeof prisma.syncRun.findMany>;

function run(source: string, startedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `r-${startedAt}`,
    source,
    status: 'SUCCESS',
    trigger: 'schedule',
    leagueId: null,
    rowCount: 42,
    detail: '{"weeks":1}',
    startedAt: new Date(startedAt),
    finishedAt: new Date(startedAt),
    ...overrides,
  };
}

/** The route reads only nextUrl.searchParams, so a URL stands in for the request. */
function req(leagueId?: string) {
  const url = new URL('http://localhost:3000/api/sync/status');
  if (leagueId) url.searchParams.set('leagueId', leagueId);
  return { nextUrl: url } as unknown as Parameters<typeof GET>[0];
}

interface Feed {
  source: string;
  scope: 'league' | 'global';
  nextRunAt: string | null;
  prevRunAt: string | null;
  overdue: boolean;
  willSkip: boolean;
  lastRun: { status: string; rowCount: number; detail: unknown } | null;
  recentRuns: { status: string; startedAt: string }[];
}

async function body(leagueId?: string) {
  const res = await GET(req(leagueId));
  return { status: res.status, json: await res.json() as { feeds: Feed[]; isCommissioner: boolean } };
}

describe('GET /api/sync/status', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockFindMany.mockReset();
    mockAuth.mockResolvedValue({ user: { role: 'MEMBER' } } as never);
    mockFindMany.mockResolvedValue([] as never);
  });

  it('returns 401 when signed out', async () => {
    mockAuth.mockResolvedValue(null as never);
    expect((await body()).status).toBe(401);
  });

  // WHY: The tab renders one card per feed whether or not it has ever run, so a
  //      feed missing from the response would silently disappear from the UI.
  it('returns every configured feed even with no history', async () => {
    const { json } = await body();
    expect(json.feeds).toHaveLength(SYNC_JOBS.length);
    expect(json.feeds.every((f) => f.lastRun === null)).toBe(true);
  });

  // WHY: findMany returns many rows per source ordered newest-first; only the
  //      newest belongs to the feed card.
  it('keeps only the newest run per source', async () => {
    mockFindMany.mockResolvedValue([
      run('NFL_WEEKLY', '2026-09-08T08:00:00Z', { status: 'FAILED' }),
      run('NFL_WEEKLY', '2026-09-01T08:00:00Z', { status: 'SUCCESS' }),
    ] as never);

    const { json } = await body();
    const weekly = json.feeds.find((f) => f.source === 'NFL_WEEKLY');
    expect(weekly?.lastRun?.status).toBe('FAILED');
  });

  // WHY: detail is stored as a JSON string; the client should not have to
  //      double-parse it.
  it('parses the stored detail JSON', async () => {
    mockFindMany.mockResolvedValue([run('NFL_WEEKLY', '2026-09-08T08:00:00Z')] as never);

    const { json } = await body();
    const weekly = json.feeds.find((f) => f.source === 'NFL_WEEKLY');
    expect(weekly?.lastRun?.detail).toEqual({ weeks: 1 });
  });

  // WHY: A truncated or hand-edited detail value must not blank the whole tab.
  it('falls back to the raw string when detail is not JSON', async () => {
    mockFindMany.mockResolvedValue([
      run('NFL_WEEKLY', '2026-09-08T08:00:00Z', { detail: 'not json' }),
    ] as never);

    const { json } = await body();
    expect(json.feeds.find((f) => f.source === 'NFL_WEEKLY')?.lastRun?.detail).toBe('not json');
  });

  // WHY: Only commissioners get the Sync now button; the client reads this flag
  //      rather than re-deriving the role.
  it('reports commissioner status', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'COMMISSIONER' } } as never);
    expect((await body()).json.isCommissioner).toBe(true);
  });

  it('returns 500 when the database read fails', async () => {
    mockFindMany.mockRejectedValue(new Error('libsql down') as never);
    expect((await body()).status).toBe(500);
  });

  // ── League scoping ────────────────────────────────────────────────────────

  // WHY: The Sync now button is disabled for a league feed with no league
  //      selected, and the badge on each card comes from this flag.
  it('marks the Sleeper feeds league-scoped and the nflverse feeds global', async () => {
    const { json } = await body();
    const scopeOf = (source: string) => json.feeds.find((f) => f.source === source)?.scope;

    expect(scopeOf('SLEEPER_LEAGUES')).toBe('league');
    expect(scopeOf('SLEEPER_SCORES')).toBe('league');
    expect(scopeOf('SLEEPER_RANKINGS')).toBe('league');
    expect(scopeOf('NFL_WEEKLY')).toBe('global');
    expect(scopeOf('NFL_SEASON_RESET')).toBe('global');
  });

  // WHY: Showing another league's sync as this league's "last run" is worse
  //      than showing nothing — it says data arrived when it did not.
  it('ignores a league-scoped run belonging to a different league', async () => {
    mockFindMany.mockResolvedValue([
      run('SLEEPER_SCORES', '2026-09-08T08:00:00Z', { leagueId: 'other-league' }),
    ] as never);

    const { json } = await body('my-league');
    expect(json.feeds.find((f) => f.source === 'SLEEPER_SCORES')?.lastRun).toBeNull();
  });

  it('reports a run that targeted the selected league', async () => {
    mockFindMany.mockResolvedValue([
      run('SLEEPER_SCORES', '2026-09-08T08:00:00Z', { leagueId: 'my-league' }),
    ] as never);

    const { json } = await body('my-league');
    expect(json.feeds.find((f) => f.source === 'SLEEPER_SCORES')?.lastRun?.status).toBe('SUCCESS');
  });

  // WHY: Scheduled runs sweep every league and record leagueId NULL, so they
  //      are the last run for whichever league you happen to be looking at.
  it('counts an unscoped sweep as the last run for any league', async () => {
    mockFindMany.mockResolvedValue([
      run('SLEEPER_SCORES', '2026-09-08T08:00:00Z', { leagueId: null }),
    ] as never);

    const { json } = await body('my-league');
    expect(json.feeds.find((f) => f.source === 'SLEEPER_SCORES')?.lastRun?.status).toBe('SUCCESS');
  });

  // WHY: A global feed has no league dimension at all — its run must show up
  //      whatever league is selected, and whatever leagueId it carries.
  it('reports a global feed regardless of the selected league', async () => {
    mockFindMany.mockResolvedValue([
      run('NFL_WEEKLY', '2026-09-08T08:00:00Z', { leagueId: null }),
    ] as never);

    const { json } = await body('my-league');
    expect(json.feeds.find((f) => f.source === 'NFL_WEEKLY')?.lastRun?.status).toBe('SUCCESS');
  });

  // WHY: With no league selected, a run aimed at one specific league is not
  //      about "everything", so it must not be presented as the last run.
  it('ignores a league-scoped run when no league is selected', async () => {
    mockFindMany.mockResolvedValue([
      run('SLEEPER_SCORES', '2026-09-08T08:00:00Z', { leagueId: 'some-league' }),
    ] as never);

    const { json } = await body();
    expect(json.feeds.find((f) => f.source === 'SLEEPER_SCORES')?.lastRun).toBeNull();
  });

  // ── Did it actually run? ──────────────────────────────────────────────────

  // WHY: This is the whole point of the overdue flag. A job that never starts
  //      writes no row at all, so without comparing against the schedule an
  //      absent run is indistinguishable from a healthy one.
  it('flags a scheduled feed that has never run as overdue', async () => {
    const { json } = await body();
    expect(json.feeds.find((f) => f.source === 'NFL_WEEKLY')?.overdue).toBe(true);
  });

  // WHY: The on-demand league sync has no cron, so "overdue" is meaningless —
  //      claiming it would put a permanent warning on a feed working correctly.
  it('never calls an on-demand feed overdue', async () => {
    const { json } = await body();
    const leagues = json.feeds.find((f) => f.source === 'SLEEPER_LEAGUES');
    expect(leagues?.prevRunAt).toBeNull();
    expect(leagues?.overdue).toBe(false);
  });

  it('clears overdue once a run lands after the scheduled time', async () => {
    mockFindMany.mockResolvedValue([
      run('NFL_WEEKLY', new Date(Date.now() - 60_000).toISOString()),
    ] as never);

    const { json } = await body();
    expect(json.feeds.find((f) => f.source === 'NFL_WEEKLY')?.overdue).toBe(false);
  });

  // WHY: A failed run is not a missing run. It reported for duty and said so,
  //      and its own status carries that — stacking "overdue" on top misleads.
  it('does not call a feed overdue when its latest run failed', async () => {
    mockFindMany.mockResolvedValue([
      run('NFL_WEEKLY', new Date(Date.now() - 60_000).toISOString(), { status: 'FAILED' }),
    ] as never);

    const feed = (await body()).json.feeds.find((f) => f.source === 'NFL_WEEKLY');
    expect(feed?.overdue).toBe(false);
    expect(feed?.lastRun?.status).toBe('FAILED');
  });

  it('reports when the schedule last came round', async () => {
    const { json } = await body();
    const weekly = json.feeds.find((f) => f.source === 'NFL_WEEKLY');
    expect(new Date(weekly!.prevRunAt!).getTime()).toBeLessThan(Date.now());
  });

  // ── Run log ───────────────────────────────────────────────────────────────

  // WHY: The log is what a commissioner reads to confirm a sync did what they
  //      expected, so it must keep the older runs the "last run" field drops.
  it('returns recent runs newest-first, not just the latest', async () => {
    mockFindMany.mockResolvedValue([
      run('NFL_WEEKLY', '2026-09-15T08:00:00Z'),
      run('NFL_WEEKLY', '2026-09-08T08:00:00Z'),
      run('NFL_WEEKLY', '2026-09-01T08:00:00Z'),
    ] as never);

    const weekly = (await body()).json.feeds.find((f) => f.source === 'NFL_WEEKLY');
    expect(weekly?.recentRuns.map((r) => r.startedAt)).toEqual([
      '2026-09-15T08:00:00.000Z',
      '2026-09-08T08:00:00.000Z',
      '2026-09-01T08:00:00.000Z',
    ]);
  });

  it('caps the run log rather than returning every row', async () => {
    mockFindMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) =>
        run('NFL_WEEKLY', `2026-09-${String(20 - i).padStart(2, '0')}T08:00:00Z`),
      ) as never,
    );

    expect((await body()).json.feeds.find((f) => f.source === 'NFL_WEEKLY')?.recentRuns)
      .toHaveLength(5);
  });

  // WHY: The log is per-league for a league feed, same as "last run" — another
  //      league's history in this one's log would be actively misleading.
  it('keeps another league out of a league feed\'s run log', async () => {
    mockFindMany.mockResolvedValue([
      run('SLEEPER_SCORES', '2026-09-15T08:00:00Z', { leagueId: 'other' }),
      run('SLEEPER_SCORES', '2026-09-08T08:00:00Z', { leagueId: 'mine' }),
    ] as never);

    const feed = (await body('mine')).json.feeds.find((f) => f.source === 'SLEEPER_SCORES');
    expect(feed?.recentRuns).toHaveLength(1);
    expect(feed?.recentRuns[0].startedAt).toBe('2026-09-08T08:00:00.000Z');
  });
});