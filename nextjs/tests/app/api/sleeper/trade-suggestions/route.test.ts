// tests/app/api/sleeper/trade-suggestions/route.test.ts
//
// GET /api/sleeper/trade-suggestions?leagueId=&userId=
//
// Identifies mutually beneficial trade opportunities by comparing positional
// surplus/deficit across teams and surfacing balanced proposals (fairness ≥ 60).
// Results are cached 10 minutes in live mode.
//
// ── Rate-limit context ────────────────────────────────────────────────────────
// Sleeper docs: stay under 1000 req/min globally; no per-endpoint throttle.
// The route makes 3 Sleeper calls per request (rosters, users, player map).
// The RouteCache prevents re-fetching within 10 minutes — tests verify this
// explicitly so the rate-limit protection is documented and regression-tested.
//
// Mocks:
//   @/lib/sleeper/client       — sleeperGet  (rosters + users)
//   @/lib/sleeper/playerCache  — getPlayerMap
//   @/lib/prisma               — nflWeeklyStat.groupBy (season totals)

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
      groupBy: jest.fn(),
    },
  },
}));

import { GET } from '@/app/api/sleeper/trade-suggestions/route';
import { sleeperGet } from '@/lib/sleeper/client';
import { getPlayerMap } from '@/lib/sleeper/playerCache';
import { prisma } from '@/lib/prisma';

const mockSleeperGet   = sleeperGet   as jest.MockedFunction<typeof sleeperGet>;
const mockGetPlayerMap = getPlayerMap as jest.MockedFunction<typeof getPlayerMap>;
const mockGroupBy      = prisma.nflWeeklyStat.groupBy as jest.MockedFunction<typeof prisma.nflWeeklyStat.groupBy>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

// League: uid-1 is QB-heavy/TE-weak; uid-2 is TE-heavy/QB-weak.
// This creates a classic trade opportunity: QB for TE swap.
const rosters = [
  {
    roster_id: 1, owner_id: 'uid-1',
    players: ['qb-elite', 'qb-backup', 'wr-1', 'rb-1'],
    settings: { wins: 5, losses: 3, fpts: 0, fpts_decimal: 0 },
  },
  {
    roster_id: 2, owner_id: 'uid-2',
    players: ['te-elite', 'te-backup', 'wr-2', 'rb-2'],
    settings: { wins: 4, losses: 4, fpts: 0, fpts_decimal: 0 },
  },
];

const users = [
  { user_id: 'uid-1', display_name: 'Alice', metadata: { team_name: 'Alpha Squad' } },
  { user_id: 'uid-2', display_name: 'Bob',   metadata: { team_name: 'Beta Force'  } },
];

// Player map: uid-1 strong at QB, weak at TE; uid-2 vice versa.
const playerMapData = new Map([
  ['qb-elite',  { name: 'Josh Allen',     position: 'QB', team: 'BUF' }],
  ['qb-backup', { name: 'Geno Smith',     position: 'QB', team: 'SEA' }],
  ['wr-1',      { name: 'Stefon Diggs',   position: 'WR', team: 'BUF' }],
  ['rb-1',      { name: 'Saquon Barkley', position: 'RB', team: 'PHI' }],
  ['te-elite',  { name: 'Travis Kelce',   position: 'TE', team: 'KC'  }],
  ['te-backup', { name: 'Mo Alie-Cox',    position: 'TE', team: 'IND' }],
  ['wr-2',      { name: 'Tyreek Hill',    position: 'WR', team: 'MIA' }],
  ['rb-2',      { name: 'Derrick Henry',  position: 'RB', team: 'TEN' }],
]);

// Season totals — balanced enough to produce a fairness score ≥ 60.
const groupByRows = [
  { playerId: 'qb-elite',  _sum: { fantasyPointsPpr: 380 } },
  { playerId: 'qb-backup', _sum: { fantasyPointsPpr: 200 } },
  { playerId: 'wr-1',      _sum: { fantasyPointsPpr: 260 } },
  { playerId: 'rb-1',      _sum: { fantasyPointsPpr: 290 } },
  { playerId: 'te-elite',  _sum: { fantasyPointsPpr: 350 } },
  { playerId: 'te-backup', _sum: { fantasyPointsPpr: 180 } },
  { playerId: 'wr-2',      _sum: { fantasyPointsPpr: 280 } },
  { playerId: 'rb-2',      _sum: { fantasyPointsPpr: 270 } },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

let seq = 0;
function freshIds() {
  seq++;
  return { leagueId: `league-tr-${seq}`, userId: 'uid-1' };
}

function makeReq(leagueId: string, userId: string): NextRequest {
  const params = new URLSearchParams({ leagueId, userId, season: '2025' });
  return new NextRequest(`http://localhost/api/sleeper/trade-suggestions?${params}`);
}

// Sets up the live-path mock chain:
//   sleeperGet × 3 (rosters, users, player map via getPlayerMap) + DB season totals.
function setupHappyPath(): void {
  mockSleeperGet
    .mockResolvedValueOnce(rosters as never)  // /league/{id}/rosters
    .mockResolvedValueOnce(users   as never); // /league/{id}/users
  mockGetPlayerMap.mockResolvedValueOnce(playerMapData as never);
  mockGroupBy.mockResolvedValueOnce(groupByRows as never);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/sleeper/trade-suggestions', () => {
  beforeEach(() => {
    mockSleeperGet.mockReset();
    mockGetPlayerMap.mockReset();
    mockGroupBy.mockReset();
    // Safe defaults — getPlayerMap is called with .catch() in the route.
    // Without a Promise-returning default, the .catch() call crashes the worker.
    mockGetPlayerMap.mockResolvedValue(new Map() as never);
    mockGroupBy.mockResolvedValue([] as never);
  });

  // WHY: leagueId drives every Sleeper roster/user call — missing it means no
  //      trade analysis can proceed.
  it('returns 400 when leagueId is missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/sleeper/trade-suggestions?userId=uid-1'));
    expect(res.status).toBe(400);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });

  // WHY: userId identifies the requesting team's roster for surplus/deficit analysis.
  it('returns 400 when userId is missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/sleeper/trade-suggestions?leagueId=l1'));
    expect(res.status).toBe(400);
  });

  // WHY: A userId not matching any roster means the user is not in this league —
  //      return 404 rather than analysing with an undefined "my" roster.
  it('returns 404 when the user has no roster in the league', async () => {
    const { leagueId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(users   as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMapData as never);
    mockGroupBy.mockResolvedValueOnce(groupByRows as never);

    const res = await GET(makeReq(leagueId, 'uid-nobody'));
    expect(res.status).toBe(404);
  });

  // WHY: The response must contain myPositionRanks (the user's rank per position)
  //      and proposals (the list of recommended trades).
  it('returns 200 with myPositionRanks and proposals on success', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res = await GET(makeReq(leagueId, userId));
    // ok() returns data directly (no { data: ... } wrapper)
    const json = await res.json() as { myPositionRanks: Record<string, number>; proposals: unknown[] };

    expect(res.status).toBe(200);
    expect(typeof json.myPositionRanks).toBe('object');
    expect(Array.isArray(json.proposals)).toBe(true);
  });

  // WHY: The algorithm filters proposals below fairness score 60 (too lopsided).
  //      For the fixture above (380-pt QB ↔ 350-pt TE), the scores should be
  //      close enough to pass the threshold — at least one proposal expected.
  it('generates at least one proposal when teams have complementary surpluses', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { proposals: { fairnessScore: number }[] };

    expect(json.proposals.length).toBeGreaterThan(0);
    // All proposals must have passed the minimum fairness threshold.
    for (const p of json.proposals) {
      expect(p.fairnessScore).toBeGreaterThanOrEqual(60);
    }
  });

  // WHY: Each proposal must carry the fields needed by the trade UI:
  //      targetTeamName, give (array), receive (array), fairnessScore, summary.
  it('returns proposals with the expected shape', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      proposals: {
        targetTeamName: string;
        give: unknown[];
        receive: unknown[];
        fairnessScore: number;
        summary: string;
      }[]
    };

    if (json.proposals.length > 0) {
      const p = json.proposals[0];
      expect(typeof p.targetTeamName).toBe('string');
      expect(Array.isArray(p.give)).toBe(true);
      expect(Array.isArray(p.receive)).toBe(true);
      expect(p.fairnessScore).toBeGreaterThanOrEqual(60);
      expect(typeof p.summary).toBe('string');
    }
  });

  // WHY (Rate-limit invariant): The route caches results for 10 minutes keyed
  //      by leagueId+userId. A second identical request must NOT trigger new
  //      Sleeper calls — verified by checking sleeperGet call count stays flat.
  //      At scale, every saved Sleeper call counts against the 1000 req/min cap.
  it('serves from in-process cache on duplicate request — no additional Sleeper calls', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    // First request — populates cache.
    const res1 = await GET(makeReq(leagueId, userId));
    expect(res1.status).toBe(200);
    const callsAfterFirst = mockSleeperGet.mock.calls.length;

    // Second identical request — must NOT call sleeperGet again.
    const res2 = await GET(makeReq(leagueId, userId));
    expect(res2.status).toBe(200);
    expect(mockSleeperGet.mock.calls.length).toBe(callsAfterFirst);
  });

  // WHY: Results are capped at 5 proposals max — the UI only displays the top 5
  //      and more would be noise. Verify the dedup+slice logic holds.
  it('returns at most 5 proposals', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { proposals: unknown[] };

    expect(json.proposals.length).toBeLessThanOrEqual(5);
  });

  // WHY: Sleeper network failures must be swallowed and returned as 502, not
  //      re-thrown — the dashboard must always get a structured response.
  it('returns 502 when a Sleeper fetch throws', async () => {
    const { leagueId, userId } = freshIds();
    mockSleeperGet.mockRejectedValueOnce(new Error('Sleeper 503'));

    const res = await GET(makeReq(leagueId, userId));
    expect(res.status).toBe(502);
  });
});
