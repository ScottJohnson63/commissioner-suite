// tests/app/api/sleeper/matchup-report/route.test.ts
//
// GET /api/sleeper/matchup-report?leagueId=&userId=&week=
//
// Projects floor/ceiling for both sides of the user's current-week matchup.
// Calls several Sleeper endpoints + DB + weather; results are cached 15 minutes.
//
// ── Rate-limit context ────────────────────────────────────────────────────────
// Sleeper docs: "stay under 1000 API calls per minute or risk IP-block."
// No auth token is required — all calls are read-only. The route uses an
// in-process RouteCache (15 min TTL for live mode) so repeated page loads
// never cause redundant Sleeper calls for the same matchup.
// A key correctness invariant is that a second identical request within the TTL
// must NOT call sleeperGet at all — tests below verify this explicitly.
//
// Mocks:
//   @/lib/sleeper/client       — sleeperGet
//   @/lib/sleeper/playerCache  — getPlayerMap
//   @/lib/prisma               — nflWeeklyStat (findMany, groupBy)
//   @/lib/weather              — getWeather
//   @/lib/odds                 — getNflOdds, getLiveOdds

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/sleeper/client', () => ({
  sleeperGet:   jest.fn(),
  SLEEPER_BASE: 'https://api.sleeper.app/v1',
}));

jest.mock('@/lib/sleeper/playerCache', () => ({
  getPlayerMap: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    nflWeeklyStat: {
      findMany:  jest.fn(),
      groupBy:   jest.fn(),
    },
  },
}));

jest.mock('@/lib/weather', () => ({
  getWeather: jest.fn(),
}));

jest.mock('@/lib/odds', () => ({
  getNflOdds:  jest.fn(),
  getLiveOdds: jest.fn(),
}));

import { GET } from '@/app/api/sleeper/matchup-report/route';
import { sleeperGet } from '@/lib/sleeper/client';
import { getPlayerMap } from '@/lib/sleeper/playerCache';
import { prisma } from '@/lib/prisma';
import { getWeather } from '@/lib/weather';

const mockSleeperGet  = sleeperGet  as jest.MockedFunction<typeof sleeperGet>;
const mockGetPlayerMap = getPlayerMap as jest.MockedFunction<typeof getPlayerMap>;
const mockFindMany    = prisma.nflWeeklyStat.findMany as jest.MockedFunction<typeof prisma.nflWeeklyStat.findMany>;
const mockGroupBy     = prisma.nflWeeklyStat.groupBy  as jest.MockedFunction<typeof prisma.nflWeeklyStat.groupBy>;
const mockGetWeather  = getWeather  as jest.MockedFunction<typeof getWeather>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

// roster_id 1 belongs to uid-1 (our user). Matchup_id 10 pairs roster 1 vs 2.
const rosters = [
  { roster_id: 1, owner_id: 'uid-1', players: ['player-a'], settings: { wins: 5, losses: 3 } },
  { roster_id: 2, owner_id: 'uid-2', players: ['player-b'], settings: { wins: 4, losses: 4 } },
];

const users = [
  { user_id: 'uid-1', display_name: 'Alice', metadata: { team_name: 'Alpha Squad' } },
  { user_id: 'uid-2', display_name: 'Bob',   metadata: { team_name: 'Beta Force'  } },
];

// Both rosters share matchup_id 10, making them opponents this week.
const matchupsRaw = [
  { roster_id: 1, matchup_id: 10, points: 115.4, starters: [], players: ['player-a'] },
  { roster_id: 2, matchup_id: 10, points:  98.2, starters: [], players: ['player-b'] },
];

// Player-A is an indoor QB; player-B is an outdoor RB.
const playerMap = new Map([
  ['player-a', { name: 'Josh Allen',  position: 'QB', team: 'BUF' }],
  ['player-b', { name: 'Saquon Barkley', position: 'RB', team: 'PHI' }],
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Unique leagueId+userId per test avoids RouteCache hits across tests
// (Sleeper docs: don't re-fetch the same matchup within 15 minutes).
let seq = 0;
function freshIds() {
  seq++;
  return { leagueId: `league-mr-${seq}`, userId: 'uid-1' };
}

function makeReq(leagueId: string, userId: string, extra: Record<string, string> = {}): NextRequest {
  const params = new URLSearchParams({ leagueId, userId, week: '5', ...extra });
  return new NextRequest(`http://localhost/api/sleeper/matchup-report?${params}`);
}

// Sets up the full happy-path mock chain:
//   sleeperGet × 3 (rosters, users, matchups) + getPlayerMap + DB empty results.
function setupHappyPath(): void {
  mockSleeperGet
    .mockResolvedValueOnce(rosters as never)   // /league/{id}/rosters
    .mockResolvedValueOnce(users   as never)   // /league/{id}/users
    .mockResolvedValueOnce(matchupsRaw as never); // /league/{id}/matchups/5
  mockGetPlayerMap.mockResolvedValueOnce(playerMap as never);
  // No historical stats → all projections are 0 (mean = 0, sd = 0)
  mockFindMany.mockResolvedValue([] as never);
  // No defensive data
  mockGroupBy.mockResolvedValue([] as never);
  // No weather impact (indoor / no data)
  mockGetWeather.mockResolvedValue(null as never);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/sleeper/matchup-report', () => {
  beforeEach(() => {
    mockSleeperGet.mockReset();
    mockGetPlayerMap.mockReset();
    mockFindMany.mockReset();
    mockGroupBy.mockReset();
    mockGetWeather.mockReset();
    // Safe defaults so error-path tests don't crash on missing mocks.
    // getPlayerMap() is called with .catch() in the route — must return a Promise.
    mockGetPlayerMap.mockResolvedValue(new Map() as never);
    mockFindMany.mockResolvedValue([] as never);
    mockGroupBy.mockResolvedValue([] as never);
    mockGetWeather.mockResolvedValue(null as never);
  });

  // WHY: leagueId is required to construct every Sleeper URL — must fail fast.
  it('returns 400 when leagueId is missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/sleeper/matchup-report?userId=uid-1'));
    expect(res.status).toBe(400);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });

  // WHY: userId is required to find the user's roster from the league rosters list.
  it('returns 400 when userId is missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/sleeper/matchup-report?leagueId=l1'));
    expect(res.status).toBe(400);
  });

  // WHY: If the userId doesn't match any roster in the league, the user has
  //      either left the league or passed an incorrect ID — return 404.
  it('returns 404 when the user has no roster in the league', async () => {
    const { leagueId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(users   as never)
      .mockResolvedValueOnce(matchupsRaw as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMap as never);
    mockFindMany.mockResolvedValue([] as never);
    mockGroupBy.mockResolvedValue([] as never);

    // Wrong userId — not in any roster
    const res = await GET(makeReq(leagueId, 'uid-nobody'));
    expect(res.status).toBe(404);
  });

  // WHY: If the user has a roster but no matchup this week (bye week or off-season),
  //      the route must return 404 rather than crash on a null matchup lookup.
  it('returns 404 when the user has no matchup this week', async () => {
    const { leagueId, userId } = freshIds();
    // matchupsRaw has no entry for roster_id 1 this "week"
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(users   as never)
      .mockResolvedValueOnce([] as never);  // empty matchups
    mockGetPlayerMap.mockResolvedValueOnce(playerMap as never);
    mockFindMany.mockResolvedValue([] as never);
    mockGroupBy.mockResolvedValue([] as never);

    const res = await GET(makeReq(leagueId, userId));
    expect(res.status).toBe(404);
  });

  // WHY: A successful projection must return the expected structure:
  //      myTeam, opponent, myPlayers, opponentPlayers, and a narrative string.
  it('returns 200 with myTeam, opponent, players, and narrative on success', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res = await GET(makeReq(leagueId, userId));
    // ok() returns data directly (no { data: ... } wrapper)
    const json = await res.json() as {
      myTeam: { name: string };
      opponent: { name: string };
      myPlayers: unknown[];
      opponentPlayers: unknown[];
      narrative: string;
    };

    expect(res.status).toBe(200);
    expect(json.myTeam.name).toBe('Alpha Squad');
    expect(json.opponent.name).toBe('Beta Force');
    expect(Array.isArray(json.myPlayers)).toBe(true);
    expect(Array.isArray(json.opponentPlayers)).toBe(true);
    expect(typeof json.narrative).toBe('string');
    expect(json.narrative.length).toBeGreaterThan(0);
  });

  // WHY (Rate-limit invariant): A second identical request within the 15-minute
  //      cache TTL must NOT make any additional Sleeper API calls. The production
  //      RouteCache stores the response keyed by leagueId+userId+week.
  //      Sleeper's global limit is 1000 req/min — repeated dashboard refreshes
  //      would exhaust this budget without caching.
  it('serves from in-process cache on duplicate request — no redundant Sleeper calls', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    // First request — populates the cache.
    const res1 = await GET(makeReq(leagueId, userId));
    expect(res1.status).toBe(200);
    const callCountAfterFirst = mockSleeperGet.mock.calls.length;

    // Second request — must hit the cache, making zero additional Sleeper calls.
    const res2 = await GET(makeReq(leagueId, userId));
    expect(res2.status).toBe(200);
    expect(mockSleeperGet.mock.calls.length).toBe(callCountAfterFirst); // no new calls
  });

  // WHY: If a Sleeper fetch throws (network error or 502), the route must return
  //      a 502 rather than crash — callers expect a structured JSON error.
  it('returns 502 when a Sleeper fetch throws', async () => {
    const { leagueId, userId } = freshIds();
    mockSleeperGet.mockRejectedValueOnce(new Error('Sleeper network error'));

    const res = await GET(makeReq(leagueId, userId));
    expect(res.status).toBe(502);
  });
});
