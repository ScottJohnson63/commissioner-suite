// tests/app/api/sleeper/trade-suggestions/route.test.ts
//
// GET /api/sleeper/trade-suggestions?leagueId=&userId=
//
// Identifies mutually beneficial trade opportunities by reading each roster as a
// depth chart and surfacing the balanced proposals (fairness ≥ 60) that improve
// both starting lineups. Results are cached 10 minutes in live mode.
//
// The second describe block below covers what the depth chart is for: which
// player a roster offers, and how much the returned set varies. Both are things
// the old surplus/deficit version got wrong by construction — it could only ever
// offer the best player at a position, so every proposal for one void was the
// same trade with a different partner's name on it.
//
// ── Rate-limit context ────────────────────────────────────────────────────────
// Sleeper docs: stay under 1000 req/min globally; no per-endpoint throttle.
// The route makes 3 Sleeper calls per request (rosters, users, player map).
// The RouteCache prevents re-fetching within 10 minutes — tests verify this
// explicitly so the rate-limit protection is documented and regression-tested.
//
// Mocks:
//   @/lib/sleeper/client       — sleeperGet  (rosters + users)
//   @/lib/sleeper/playerCache  — getPlayerMapSafe
//   @/lib/sleeper/lineup       — getStarterSlots
//   @/lib/prisma               — nflWeeklyStat.groupBy (season totals)

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/sleeper/client', () => ({
  // Keep SLEEPER_BASE and the SLEEPER_TTL table real; only the fetch is faked.
  ...jest.requireActual<typeof import('@/lib/sleeper/client')>('@/lib/sleeper/client'),
  sleeperGet: jest.fn(),
}));

jest.mock('@/lib/sleeper/playerCache', () => ({
  getPlayerMapSafe: jest.fn(),
}));

// Mocked as a module rather than through sleeperGet: the fixtures queue
// sleeperGet responses in order, and an extra call would shift that sequence.
jest.mock('@/lib/sleeper/scoringSettings', () => ({
  getScoringSettings: jest.fn(async () => ({ rec: 0.5, fgm_30_39: 3, xpm: 1, sack: 1, int: 2 })),
}));

// Same reason as the scoring settings above — getStarterSlots reads the league
// payload through sleeperGet, and a fourth call would shift the queued order.
// The slot counts are the line every depth rank and every trade cost in these
// tests is drawn against, so they are stated here rather than defaulted.
jest.mock('@/lib/sleeper/lineup', () => ({
  getStarterSlots: jest.fn(async () => ({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1 })),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    nflWeeklyStat: {
      groupBy:   jest.fn(),
      findMany:  jest.fn(),
      aggregate: jest.fn(),
    },
  },
}));

import { GET } from '@/app/api/sleeper/trade-suggestions/route';
import { sleeperGet } from '@/lib/sleeper/client';
import { getPlayerMapSafe } from '@/lib/sleeper/playerCache';
import { prisma } from '@/lib/prisma';
import { clearStatsSeasonCache } from '@/lib/statsSeason';
import { clearGsisXrefCache } from '@/lib/sleeper/gsisXref';

const mockSleeperGet   = sleeperGet   as jest.MockedFunction<typeof sleeperGet>;
const mockGetPlayerMap = getPlayerMapSafe as jest.MockedFunction<typeof getPlayerMapSafe>;
const mockGroupBy      = prisma.nflWeeklyStat.groupBy as jest.MockedFunction<typeof prisma.nflWeeklyStat.groupBy>;
const mockFindMany     = prisma.nflWeeklyStat.findMany as jest.MockedFunction<typeof prisma.nflWeeklyStat.findMany>;
const mockAggregate    = prisma.nflWeeklyStat.aggregate as jest.MockedFunction<typeof prisma.nflWeeklyStat.aggregate>;

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
// gsisId is the key NflWeeklyStat actually stores; the roster IDs above are
// Sleeper's. The two are deliberately different strings here, because a fixture
// where they coincide cannot tell a working translation from a missing one.
// Every player carries one, so gsisXref never falls through to its name index —
// which matters because that index also runs through groupBy, and would
// otherwise consume the season-totals mock below.
const playerMapData = new Map([
  ['qb-elite',  { name: 'Josh Allen',     position: 'QB', team: 'BUF', gsisId: '00-gsis-qb-elite'  }],
  ['qb-backup', { name: 'Geno Smith',     position: 'QB', team: 'SEA', gsisId: '00-gsis-qb-backup' }],
  ['wr-1',      { name: 'Stefon Diggs',   position: 'WR', team: 'BUF', gsisId: '00-gsis-wr-1'      }],
  ['rb-1',      { name: 'Saquon Barkley', position: 'RB', team: 'PHI', gsisId: '00-gsis-rb-1'      }],
  ['te-elite',  { name: 'Travis Kelce',   position: 'TE', team: 'KC',  gsisId: '00-gsis-te-elite'  }],
  ['te-backup', { name: 'Mo Alie-Cox',    position: 'TE', team: 'IND', gsisId: '00-gsis-te-backup' }],
  ['wr-2',      { name: 'Tyreek Hill',    position: 'WR', team: 'MIA', gsisId: '00-gsis-wr-2'      }],
  ['rb-2',      { name: 'Derrick Henry',  position: 'RB', team: 'TEN', gsisId: '00-gsis-rb-2'      }],
]);

// Season totals — balanced enough to produce a fairness score ≥ 60. Keyed on
// GSIS IDs, as the real table is.
//
// Weekly rows rather than a pre-summed total, because the route now scores each
// week under the league's own rules and adds them up itself; a SQL SUM can only
// add the stored column, which is full PPR and zero for kickers and defenses.
// One row per player stands in for a whole season here.
const statRows = [
  { playerId: '00-gsis-qb-elite',  position: 'QB', fantasyPoints: 380, receptions: 0 },
  { playerId: '00-gsis-qb-backup', position: 'QB', fantasyPoints: 200, receptions: 0 },
  { playerId: '00-gsis-wr-1',      position: 'WR', fantasyPoints: 260, receptions: 0 },
  { playerId: '00-gsis-rb-1',      position: 'RB', fantasyPoints: 290, receptions: 0 },
  { playerId: '00-gsis-te-elite',  position: 'TE', fantasyPoints: 350, receptions: 0 },
  { playerId: '00-gsis-te-backup', position: 'TE', fantasyPoints: 180, receptions: 0 },
  { playerId: '00-gsis-wr-2',      position: 'WR', fantasyPoints: 280, receptions: 0 },
  { playerId: '00-gsis-rb-2',      position: 'RB', fantasyPoints: 270, receptions: 0 },
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
//   sleeperGet × 3 (rosters, users, player map via getPlayerMapSafe) + DB season totals.
function setupHappyPath(): void {
  mockSleeperGet
    .mockResolvedValueOnce(rosters as never)  // /league/{id}/rosters
    .mockResolvedValueOnce(users   as never); // /league/{id}/users
  mockGetPlayerMap.mockResolvedValueOnce(playerMapData as never);
  mockFindMany.mockResolvedValue(statRows as never);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/sleeper/trade-suggestions', () => {
  beforeEach(() => {
    mockSleeperGet.mockReset();
    mockGetPlayerMap.mockReset();
    mockGroupBy.mockReset();
    mockFindMany.mockReset();
    mockAggregate.mockReset();
    // Safe defaults — getPlayerMapSafe is called with .catch() in the route.
    // Without a Promise-returning default, the .catch() call crashes the worker.
    mockGetPlayerMap.mockResolvedValue(new Map() as never);
    mockGroupBy.mockResolvedValue([] as never);
    mockFindMany.mockResolvedValue([] as never);
    // The requested season has rows, so no season fallback unless a test says so.
    mockAggregate.mockResolvedValue({ _max: { week: 18 } } as never);
    // Both helpers memoise per season across calls; each test starts clean.
    clearStatsSeasonCache();
    clearGsisXrefCache();
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
    mockFindMany.mockResolvedValue(statRows as never);

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

  // ── Stat lookup: Sleeper IDs vs GSIS IDs ────────────────────────────────────

  // WHY: rosters are Sleeper IDs, NflWeeklyStat is keyed on GSIS IDs. Querying
  //      with the former returns nothing, every seasonPts falls to 0, and a trade
  //      between two rosters of zeroes scores as perfectly fair — a confident,
  //      meaningless answer rather than a visible failure.
  it('queries season totals with GSIS IDs, never Sleeper IDs', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    await GET(makeReq(leagueId, userId));

    const queried = (mockFindMany.mock.calls[0]?.[0] as
      { where: { playerId: { in: string[] } } }).where.playerId.in;

    expect(queried).toEqual(expect.arrayContaining(['00-gsis-qb-elite', '00-gsis-te-elite']));
    expect(queried).not.toContain('qb-elite');
  });

  // WHY: the totals come back on GSIS IDs and every roster, rank and proposal
  //      downstream is on Sleeper IDs. Without the map back the points land on
  //      keys nothing reads, which is indistinguishable from no data.
  it('carries season points through onto the Sleeper-keyed proposals', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      proposals: { give: { playerId: string; seasonPts: number }[];
                   receive: { playerId: string; seasonPts: number }[] }[];
    };

    const everyPlayer = json.proposals.flatMap((pr) => [...pr.give, ...pr.receive]);
    expect(everyPlayer.length).toBeGreaterThan(0);
    // A zero here means the totals never made it back from the query.
    expect(everyPlayer.every((pl) => pl.seasonPts > 0)).toBe(true);

    const allen = everyPlayer.find((pl) => pl.playerId === 'qb-elite');
    if (allen) expect(allen.seasonPts).toBe(380);
  });

  // ── Season resolution ───────────────────────────────────────────────────────

  // WHY: before kickoff the live season has no rows. Scoring fairness off an
  //      empty season rates every proposal 100; last season's totals are the
  //      honest baseline, and the response flags which season it used.
  it('falls back to the last season with data and flags it', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockAggregate.mockImplementation((async (args: { where: { season: number } }) => ({
      _max: { week: args.where.season === 2024 ? 18 : null },
    })) as never);
    clearStatsSeasonCache();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { statsSeason: number; statsFallback: boolean };

    expect(json.statsSeason).toBe(2024);
    expect(json.statsFallback).toBe(true);
    expect((mockFindMany.mock.calls[0]?.[0] as { where: { season: number } }).where.season)
      .toBe(2024);
  });

  // WHY: the flag drives a caption in the UI. Setting it when the season is the
  //      live one would caption every panel with a disclaimer that is not true.
  it('does not flag a fallback when the requested season has rows', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { statsSeason: number; statsFallback: boolean };

    expect(json.statsSeason).toBe(2025);
    expect(json.statsFallback).toBe(false);
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

// ── Roster-shape behaviour ────────────────────────────────────────────────────
//
// A deeper league than the fixture above, because depth is the whole subject:
// uid-1 (me) starts two RBs and rosters four, has no tight end at all, and has
// exactly one quarterback. Its partners are each lopsided a different way.

const deepRosters = [
  {
    roster_id: 1, owner_id: 'uid-1',
    // RB-rich, TE-barren, one QB and no second one behind him.
    players: ['qb-1', 'rb-1', 'rb-2', 'rb-3', 'rb-4', 'wr-1', 'wr-2', 'k-1'],
    settings: { wins: 5, losses: 3, fpts: 0, fpts_decimal: 0 },
  },
  {
    roster_id: 2, owner_id: 'uid-2',
    // Two startable TEs in a league that starts one; thin at RB.
    players: ['qb-2', 'te-1', 'te-2', 'rb-5', 'wr-3', 'wr-4'],
    settings: { wins: 4, losses: 4, fpts: 0, fpts_decimal: 0 },
  },
  {
    roster_id: 3, owner_id: 'uid-3',
    // Three startable WRs in a league that starts two; weak RB2.
    players: ['qb-3', 'wr-5', 'wr-6', 'wr-7', 'te-3', 'rb-6', 'rb-7'],
    settings: { wins: 6, losses: 2, fpts: 0, fpts_decimal: 0 },
  },
  {
    roster_id: 4, owner_id: 'uid-4',
    // An elite TE, a startable one behind him, and no running backs at all.
    players: ['qb-4', 'te-4', 'te-5', 'wr-8'],
    settings: { wins: 2, losses: 6, fpts: 0, fpts_decimal: 0 },
  },
];

const deepUsers = [
  { user_id: 'uid-1', display_name: 'Alice', metadata: { team_name: 'Alpha Squad' } },
  { user_id: 'uid-2', display_name: 'Bob',   metadata: { team_name: 'Beta Force'  } },
  { user_id: 'uid-3', display_name: 'Cara',  metadata: { team_name: 'Gamma Gang'  } },
  { user_id: 'uid-4', display_name: 'Dan',   metadata: { team_name: 'Delta Dawgs' } },
];

const deepPlayers: [string, string, string, number][] = [
  // id,     name,          position, season points
  ['qb-1',  'My QB1',       'QB', 320],
  ['rb-1',  'My RB1',       'RB', 300],
  ['rb-2',  'My RB2',       'RB', 250],
  ['rb-3',  'My RB3',       'RB', 220],
  ['rb-4',  'My RB4',       'RB', 190],
  ['wr-1',  'My WR1',       'WR', 240],
  ['wr-2',  'My WR2',       'WR', 210],
  ['k-1',   'My K',         'K',  120],
  ['qb-2',  'Their QB',     'QB', 280],
  ['te-1',  'Their TE1',    'TE', 260],
  ['te-2',  'Their TE2',    'TE', 230],
  ['rb-5',  'Their RB1',    'RB', 200],
  ['wr-3',  'Their WR1',    'WR', 180],
  ['wr-4',  'Their WR2',    'WR', 170],
  ['qb-3',  'Gamma QB',     'QB', 240],
  ['wr-5',  'Gamma WR1',    'WR', 320],
  ['wr-6',  'Gamma WR2',    'WR', 300],
  ['wr-7',  'Gamma WR3',    'WR', 270],
  ['te-3',  'Gamma TE',     'TE', 240],
  ['rb-6',  'Gamma RB1',    'RB', 210],
  ['rb-7',  'Gamma RB2',    'RB', 150],
  ['qb-4',  'Delta QB',     'QB', 210],
  ['te-4',  'Delta TE1',    'TE', 420],
  ['te-5',  'Delta TE2',    'TE', 200],
  ['wr-8',  'Delta WR',     'WR', 150],
];

const deepPlayerMap = new Map(
  deepPlayers.map(([id, name, position]) =>
    [id, { name, position, team: 'NFL', gsisId: `00-gsis-${id}` }]),
);

const deepStatRows = deepPlayers.map(([id, , position, pts]) =>
  ({ playerId: `00-gsis-${id}`, position, fantasyPoints: pts, receptions: 0 }));

interface ProposalJson {
  targetOwnerId:   string;
  give:            { playerId: string; position: string; depthRank: number; starter: boolean }[];
  receive:         { playerId: string; position: string; depthRank: number; starter: boolean }[];
  fairnessScore:   number;
  lineupGain:      number;
  theirLineupGain: number;
  summary:         string;
}

describe('GET /api/sleeper/trade-suggestions — roster shape', () => {
  beforeEach(() => {
    mockSleeperGet.mockReset();
    mockGetPlayerMap.mockReset();
    mockGroupBy.mockReset();
    mockFindMany.mockReset();
    mockAggregate.mockReset();
    mockGetPlayerMap.mockResolvedValue(new Map() as never);
    mockGroupBy.mockResolvedValue([] as never);
    mockAggregate.mockResolvedValue({ _max: { week: 18 } } as never);
    clearStatsSeasonCache();
    clearGsisXrefCache();
  });

  async function deepProposals(): Promise<ProposalJson[]> {
    const { leagueId, userId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(deepRosters as never)
      .mockResolvedValueOnce(deepUsers   as never);
    mockGetPlayerMap.mockResolvedValueOnce(deepPlayerMap as never);
    mockFindMany.mockResolvedValue(deepStatRows as never);

    const res  = await GET(makeReq(leagueId, userId));
    expect(res.status).toBe(200);
    const json = await res.json() as { proposals: ProposalJson[] };
    return json.proposals;
  }

  // WHY: the point of the rewrite. One void used to produce one proposal built
  //      on one player, repeated against every partner who happened to have a
  //      surplus there. A roster with four RBs and no TE has several different
  //      ways to fill the hole and should be shown more than one of them.
  it('varies the players and the partners across the returned proposals', async () => {
    const proposals = await deepProposals();

    expect(proposals.length).toBeGreaterThan(1);

    const partners  = new Set(proposals.map((p) => p.targetOwnerId));
    const givenIds  = new Set(proposals.flatMap((p) => p.give.map((pl) => pl.playerId)));
    expect(partners.size).toBeGreaterThan(1);
    expect(givenIds.size).toBeGreaterThan(1);

    // And no single player carries the whole list.
    for (const id of givenIds) {
      const appearances = proposals.filter((p) => p.give.some((pl) => pl.playerId === id));
      expect(appearances.length).toBeLessThan(proposals.length);
    }
  });

  // WHY: the old finder offered each roster's best player at a position, which
  //      on this fixture means offering the only quarterback to fill the tight
  //      end hole — swapping the void for a new one. Cost is measured against
  //      the man who slides up, and behind qb-1 there is nobody.
  it('never offers the only starter at a position with nothing behind him', async () => {
    const proposals = await deepProposals();

    const given = proposals.flatMap((p) => p.give.map((pl) => pl.playerId));
    expect(given.length).toBeGreaterThan(0);
    expect(given).not.toContain('qb-1');
    // The kicker is never offered either — he scores nothing under this
    // league's rules, so there is no deal in which he is worth a roster spot.
    expect(given).not.toContain('k-1');
  });

  // WHY: depth behind the starter line is what a roster can actually spare, so
  //      at least some proposals should be spending it rather than a starter.
  it('offers depth from behind the starter line', async () => {
    const proposals = await deepProposals();

    expect(proposals.some((p) => p.give.every((pl) => !pl.starter))).toBe(true);
    // RB3 and RB4 are behind two starting slots; either is free to move.
    const given = proposals.flatMap((p) => p.give.map((pl) => pl.playerId));
    expect(given.some((id) => id === 'rb-3' || id === 'rb-4')).toBe(true);
  });

  // WHY: a 420-point tight end cannot be bought with any single spare piece
  //      without failing the fairness test — 220-for-420 scores 52. Two spare
  //      backs together score 98, and both lineups still come out ahead. A
  //      one-player-per-side finder simply cannot see that trade.
  it('packages two spare players when no single one balances a star', async () => {
    const proposals = await deepProposals();

    const packaged = proposals.filter((p) => p.give.length > 1 || p.receive.length > 1);
    expect(packaged.length).toBeGreaterThan(0);
    for (const p of packaged) {
      expect(p.fairnessScore).toBeGreaterThanOrEqual(60);
    }
    // Specifically: the elite TE is reachable, and only as a package.
    const forEliteTe = proposals.find((p) => p.receive.some((pl) => pl.playerId === 'te-4'));
    expect(forEliteTe?.give.length).toBe(2);
  });

  // WHY: a proposal that does not improve the lineup is not a suggestion, and
  //      one the other manager has no reason to accept is not a trade. Both
  //      deltas are computed on the same starting-slot arithmetic, so both are
  //      assertable.
  it('only returns trades that improve both starting lineups', async () => {
    const proposals = await deepProposals();

    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(p.lineupGain).toBeGreaterThan(0);
      expect(p.theirLineupGain).toBeGreaterThan(0);
      expect(p.fairnessScore).toBeGreaterThanOrEqual(60);
    }
  });

  // WHY: the depth rank is the answer to "why this player?" — the panel prints
  //      it as "RB3" beside the name — and it is taken on the roster the player
  //      is leaving, not on the one receiving him.
  it('labels every player with his own roster depth rank', async () => {
    const proposals = await deepProposals();

    const myDepth: Record<string, number> = { 'rb-1': 1, 'rb-2': 2, 'rb-3': 3, 'rb-4': 4 };
    for (const p of proposals) {
      for (const pl of [...p.give, ...p.receive]) {
        expect(pl.depthRank).toBeGreaterThan(0);
      }
      for (const pl of p.give) {
        if (myDepth[pl.playerId]) expect(pl.depthRank).toBe(myDepth[pl.playerId]);
        // Two RB slots: ranks 1 and 2 start, 3 and 4 do not.
        if (pl.position === 'RB') expect(pl.starter).toBe(pl.depthRank <= 2);
      }
    }
  });

  // WHY: rank is taken on the whole starting group, not the best player. uid-1
  //      starts two RBs and is deepest in the league at the position; a
  //      single-best-player rank cannot see the difference between that and one
  //      elite back with nothing behind him.
  it('ranks positions on the starting group, and skips positions nobody rosters', async () => {
    const { leagueId, userId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(deepRosters as never)
      .mockResolvedValueOnce(deepUsers   as never);
    mockGetPlayerMap.mockResolvedValueOnce(deepPlayerMap as never);
    mockFindMany.mockResolvedValue(deepStatRows as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      myPositionRanks: Record<string, number>;
      starterSlots:    Record<string, number>;
    };

    // RB: mine is 300 + 250 = 550, the best top-two in the league.
    expect(json.myPositionRanks.RB).toBe(1);
    // TE: rostered by three teams and not by me, so last of four.
    expect(json.myPositionRanks.TE).toBe(4);
    // K: the fixture's kicker rows carry no made kicks, so the league scores
    // nothing at the position. A rank of "#1" there would be a badge for a
    // column of zeroes, so the position is left off entirely.
    expect(json.myPositionRanks).not.toHaveProperty('K');
    // The slots come back so the panel can say what "RB3" was measured against.
    expect(json.starterSlots).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1 });
  });
});
