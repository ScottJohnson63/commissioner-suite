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
//   @/lib/sleeper/playerCache  — getPlayerMapSafe
//   @/lib/prisma               — nflWeeklyStat (findMany, groupBy)
//   @/lib/weather              — getWeather
//   @/lib/odds                 — getNflOdds, getLiveOdds

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

jest.mock('@/lib/prisma', () => ({
  prisma: {
    nflWeeklyStat: {
      findMany:  jest.fn(),
      groupBy:   jest.fn(),
      aggregate: jest.fn(),
    },
    // Fixtures for the context dialog. Empty by default: the context is
    // read-only and must never change a projection, so the cases below are
    // unaffected by it — the ones that exercise it set their own.
    nflGame: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/weather', () => ({
  getWeather:      jest.fn(),
  // What the context layer actually calls: a forecast is taken at the venue,
  // which for an international game is not any team's home ground.
  getVenueWeather: jest.fn(),
}));

// Mocked as a module rather than through sleeperGet: the fixtures below queue
// sleeperGet responses in order, and a fourth call would shift that sequence.
// Half-PPR with distance-tiered kicking — the real shape of these leagues.
jest.mock('@/lib/sleeper/scoringSettings', () => ({
  getScoringSettings: jest.fn(async () => ({
    rec: 0.5,
    fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5, fgm_60p: 6,
    xpm: 1, fgmiss_0_19: -1,
    sack: 1, int: 2, ff: 1, fum_rec: 2, def_td: 6, safe: 2, blk_kick: 2,
    pts_allow_0: 12, pts_allow_1_6: 8, pts_allow_7_13: 6, pts_allow_14_20: 4,
    pts_allow_21_27: 3, pts_allow_28_34: -1, pts_allow_35p: -5,
  })),
}));

jest.mock('@/lib/odds', () => ({
  getNflOdds:  jest.fn(),
  getLiveOdds: jest.fn(),
}));

import { GET, clearBaselineCache } from '@/app/api/sleeper/matchup-report/route';
import { sleeperGet } from '@/lib/sleeper/client';
import { getPlayerMapSafe } from '@/lib/sleeper/playerCache';
import { prisma } from '@/lib/prisma';
import { getVenueWeather } from '@/lib/weather';
import { clearStatsSeasonCache } from '@/lib/statsSeason';
import { clearGsisXrefCache } from '@/lib/sleeper/gsisXref';

const mockSleeperGet  = sleeperGet  as jest.MockedFunction<typeof sleeperGet>;
const mockGetPlayerMap = getPlayerMapSafe as jest.MockedFunction<typeof getPlayerMapSafe>;
const mockFindMany    = prisma.nflWeeklyStat.findMany as jest.MockedFunction<typeof prisma.nflWeeklyStat.findMany>;
const mockGroupBy     = prisma.nflWeeklyStat.groupBy  as jest.MockedFunction<typeof prisma.nflWeeklyStat.groupBy>;
const mockGetWeather  = getVenueWeather as jest.MockedFunction<typeof getVenueWeather>;
const mockAggregate   = prisma.nflWeeklyStat.aggregate as jest.MockedFunction<typeof prisma.nflWeeklyStat.aggregate>;
const mockGames       = prisma.nflGame.findMany as jest.MockedFunction<typeof prisma.nflGame.findMany>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

// roster_id 1 belongs to uid-1 (our user). Matchup_id 10 pairs roster 1 vs 2.
// Each roster carries one starter and one bench player, so the team totals can
// be told apart from a plain sum over the roster.
const rosters = [
  { roster_id: 1, owner_id: 'uid-1', players: ['player-a', 'bench-a'], settings: { wins: 5, losses: 3 } },
  { roster_id: 2, owner_id: 'uid-2', players: ['player-b', 'bench-b'], settings: { wins: 4, losses: 4 } },
];

const users = [
  { user_id: 'uid-1', display_name: 'Alice', metadata: { team_name: 'Alpha Squad' } },
  { user_id: 'uid-2', display_name: 'Bob',   metadata: { team_name: 'Beta Force'  } },
];

// Both rosters share matchup_id 10, making them opponents this week.
// The "0" on roster 1 is Sleeper's padding for an unfilled lineup slot, not a
// player — every real league payload carries them.
const matchupsRaw = [
  { roster_id: 1, matchup_id: 10, points: 115.4, starters: ['player-a', '0'], players: ['player-a', 'bench-a'] },
  { roster_id: 2, matchup_id: 10, points:  98.2, starters: ['player-b'],      players: ['player-b', 'bench-b'] },
];

// Player-A is an indoor QB; player-B is an outdoor RB.
// gsisId is the key NflWeeklyStat stores; the roster IDs are Sleeper's. Keeping
// them distinct is what lets a test tell a working translation from a missing
// one. Both players carry one, so gsisXref never falls through to its name
// index — which also runs through groupBy, and would otherwise consume the
// defensive-strength mock.
const playerMap = new Map([
  ['player-a', { name: 'Josh Allen',      position: 'QB', team: 'BUF', gsisId: '00-gsis-a'  }],
  ['player-b', { name: 'Saquon Barkley',  position: 'RB', team: 'PHI', gsisId: '00-gsis-b'  }],
  ['bench-a',  { name: 'Gus Edwards',     position: 'RB', team: 'LAC', gsisId: '00-gsis-ba' }],
  ['bench-b',  { name: 'Tyler Boyd',      position: 'WR', team: 'TEN', gsisId: '00-gsis-bb' }],
]);

// 10 pts/wk for the starters, 30 for the bench — deliberately lopsided so a
// total that quietly includes the bench cannot be mistaken for a correct one.
//
// Points are given as `fantasyPoints` with no receptions: the route scores from
// component columns under the league's own rules now, so a fixture that set
// `fantasyPointsPpr` would be describing a column nothing reads.
const statRows = [
  { playerId: '00-gsis-a',  week: 4, position: 'QB', fantasyPoints: 10, receptions: 0 },
  { playerId: '00-gsis-b',  week: 4, position: 'RB', fantasyPoints: 10, receptions: 0 },
  { playerId: '00-gsis-ba', week: 4, position: 'RB', fantasyPoints: 30, receptions: 0 },
  { playerId: '00-gsis-bb', week: 4, position: 'WR', fantasyPoints: 30, receptions: 0 },
];

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
//   sleeperGet × 3 (rosters, users, matchups) + getPlayerMapSafe + DB empty results.
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
    mockAggregate.mockReset();
    mockGames.mockReset();
    mockGames.mockResolvedValue([] as never);
    // Safe defaults so error-path tests don't crash on missing mocks.
    // getPlayerMapSafe() is called with .catch() in the route — must return a Promise.
    mockGetPlayerMap.mockResolvedValue(new Map() as never);
    mockFindMany.mockResolvedValue([] as never);
    mockGroupBy.mockResolvedValue([] as never);
    mockGetWeather.mockResolvedValue(null as never);
    // The requested season has rows through week 18, so no season fallback.
    mockAggregate.mockResolvedValue({ _max: { week: 18 } } as never);
    // Both helpers memoise per season across calls; each test starts clean.
    clearStatsSeasonCache();
    clearGsisXrefCache();
    clearBaselineCache();
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

  // ── Stat lookup: Sleeper IDs vs GSIS IDs ────────────────────────────────────

  // WHY: rosters are Sleeper IDs and NflWeeklyStat is keyed on GSIS IDs, so the
  //      form window has to be queried through the translation. Without it the
  //      query returns nothing and every projection is built from a zero mean —
  //      a report that renders confidently and means nothing.
  it('queries player form with GSIS IDs, never Sleeper IDs', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    await GET(makeReq(leagueId, userId));

    const queried = (mockFindMany.mock.calls[0]?.[0] as
      { where: { playerId: { in: string[] } } }).where.playerId.in;

    expect(queried).toEqual(expect.arrayContaining(['00-gsis-a', '00-gsis-b']));
    expect(queried).not.toContain('player-a');
  });

  // WHY: the returned rows are GSIS-keyed and the projection map is Sleeper-keyed.
  //      Skipping the map back leaves every projection at the zero default even
  //      though the query found the rows.
  it('maps returned form rows back onto Sleeper IDs', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockFindMany.mockResolvedValue([
      { playerId: '00-gsis-a', week: 3, position: 'QB', fantasyPoints: 24, receptions: 0 },
      { playerId: '00-gsis-a', week: 4, position: 'QB', fantasyPoints: 20, receptions: 0 },
    ] as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { myPlayers: { playerId: string; projected: number }[] };

    const allen = json.myPlayers.find((pl) => pl.playerId === 'player-a');
    expect(allen?.projected).toBeGreaterThan(0);
  });

  // ── Season resolution ───────────────────────────────────────────────────────

  // WHY: in week 1 the live season has no completed weeks at all. Falling back to
  //      the last season with rows is what keeps the report from being built on
  //      nothing, and the response says which season it used.
  it('falls back to the last season with data and flags it', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockAggregate.mockImplementation((async (args: { where: { season: number } }) => ({
      _max: { week: args.where.season === 2024 ? 18 : null },
    })) as never);
    clearStatsSeasonCache();

    const res  = await GET(makeReq(leagueId, userId, { season: '2025' }));
    const json = await res.json() as { statsSeason: number; statsFallback: boolean };

    expect(json.statsSeason).toBe(2024);
    expect(json.statsFallback).toBe(true);
    expect((mockFindMany.mock.calls[0]?.[0] as { where: { season: number } }).where.season)
      .toBe(2024);
  });

  // WHY: a fallback season's week numbers have nothing to do with the live week.
  //      Asking for "the five weeks before week 5" of a completed season would
  //      read its opening stretch; the end of its regular season is the recent
  //      form. Weeks 19-22 are excluded upstream — see src/lib/statsSeason.ts.
  it('reads the end of a fallback season, not the live week window', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockAggregate.mockImplementation((async (args: { where: { season: number } }) => ({
      _max: { week: args.where.season === 2024 ? 18 : null },
    })) as never);
    clearStatsSeasonCache();

    await GET(makeReq(leagueId, userId, { season: '2025' })); // live week 5

    expect((mockFindMany.mock.calls[0]?.[0] as
      { where: { week: { gte: number; lte: number } } }).where.week)
      .toEqual({ gte: 13, lte: 18 });
  });

  // WHY: mid-season the nflverse sync trails live play, so the last completed
  //      week and the last synced week are not the same. Anchoring on the latter
  //      is what keeps the window from ending on a week with no rows.
  it('clamps the form window to the last week that has rows', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockAggregate.mockResolvedValue({ _max: { week: 2 } } as never);
    clearStatsSeasonCache();

    await GET(makeReq(leagueId, userId)); // ?week=5, only 2 weeks synced

    expect((mockFindMany.mock.calls[0]?.[0] as
      { where: { week: { gte: number; lte: number } } }).where.week)
      .toEqual({ gte: 1, lte: 2 });
  });

  // ── Starting lineup vs bench ────────────────────────────────────────────────

  // WHY: a bench player cannot score for you this week. Counting one inflates a
  //      deep roster against an opponent who simply carries fewer players, which
  //      is what the headline number is supposed to compare.
  it('builds the team total from starters only', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockFindMany.mockResolvedValue(statRows as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { myTeam: { projected: number; starterCount: number } };

    // 10 from the starter, not 40 with the 30-point bench player folded in.
    expect(json.myTeam.projected).toBe(10);
    expect(json.myTeam.starterCount).toBe(1);
  });

  // WHY: the bench is real information — it is what you could have started — so
  //      it is reported alongside the total rather than dropped from the response.
  it('reports bench points separately from the total', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockFindMany.mockResolvedValue(statRows as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      myTeam: { projected: number; benchProjected: number; benchCount: number };
    };

    expect(json.myTeam.benchProjected).toBe(30);
    expect(json.myTeam.benchCount).toBe(1);
    expect(json.myTeam.projected).not.toBe(40); // never silently combined
  });

  // WHY: the breakdown is meant to show the whole roster; only the arithmetic
  //      changed. Dropping the bench from the list would lose the comparison the
  //      bench figure invites the reader to make.
  it('still returns every player, flagged by lineup status', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockFindMany.mockResolvedValue(statRows as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { myPlayers: { playerId: string; starter: boolean }[] };

    expect(json.myPlayers.map((pl) => pl.playerId).sort()).toEqual(['bench-a', 'player-a']);
    expect(json.myPlayers.find((pl) => pl.playerId === 'player-a')?.starter).toBe(true);
    expect(json.myPlayers.find((pl) => pl.playerId === 'bench-a')?.starter).toBe(false);
  });

  // WHY: the list reads as a lineup with a bench under it, so the order has to
  //      be guaranteed rather than inherited from Sleeper's roster array — which
  //      is not in slot order, while the `starters` array is.
  it('returns starters ahead of bench players', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { myPlayers: { starter: boolean }[] };

    const firstBench = json.myPlayers.findIndex((pl) => !pl.starter);
    const lastStarter = json.myPlayers.map((pl) => pl.starter).lastIndexOf(true);
    expect(lastStarter).toBeLessThan(firstBench);
  });

  // WHY: Sleeper pads unfilled lineup slots with the string "0". Treated as an
  //      ID it becomes a phantom starter projecting 0, which drags the team
  //      total down and shows an unnamed row in the breakdown.
  it('ignores the "0" padding in Sleeper\'s starters array', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      myTeam: { starterCount: number };
      myPlayers: { playerId: string }[];
    };

    expect(json.myTeam.starterCount).toBe(1); // 'player-a' only, not 'player-a' + '0'
    expect(json.myPlayers.map((pl) => pl.playerId)).not.toContain('0');
  });

  // WHY: before kickoff most leagues have not set a lineup, and Sleeper reports
  //      no starters at all. A team total of 0.0 reads as a broken panel, so the
  //      roster is treated as all-starting until a lineup exists.
  it('falls back to the whole roster when no lineup is set', async () => {
    const { leagueId, userId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(users   as never)
      .mockResolvedValueOnce(matchupsRaw.map((m) => ({ ...m, starters: [] })) as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMap as never);
    mockFindMany.mockResolvedValue(statRows as never);
    mockGroupBy.mockResolvedValue([] as never);
    mockGetWeather.mockResolvedValue(null as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      myTeam: { projected: number; starterCount: number; benchCount: number };
      myPlayers: { starter: boolean }[];
    };

    expect(json.myTeam.starterCount).toBe(2);
    expect(json.myTeam.benchCount).toBe(0);
    expect(json.myTeam.projected).toBe(40); // 10 + 30, the whole roster
    expect(json.myPlayers.every((pl) => pl.starter)).toBe(true);
  });

  // WHY: Sleeper's roster array is unordered; its `starters` array is in lineup
  //      slot order (QB, RB, RB, WR …). Reading the breakdown as a lineup
  //      depends on following the latter.
  it('orders starters by lineup slot, not roster position', async () => {
    const { leagueId, userId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(users   as never)
      // Roster order is [player-a, bench-a]; the lineup starts them reversed.
      .mockResolvedValueOnce(matchupsRaw.map((m) => (
        m.roster_id === 1 ? { ...m, starters: ['bench-a', 'player-a'] } : m
      )) as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMap as never);
    mockFindMany.mockResolvedValue(statRows as never);
    mockGroupBy.mockResolvedValue([] as never);
    mockGetWeather.mockResolvedValue(null as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { myPlayers: { playerId: string }[] };

    expect(json.myPlayers.map((pl) => pl.playerId)).toEqual(['bench-a', 'player-a']);
  });

  // ── Team band: combining spread, not adding floors ──────────────────────────
  //
  // Every fixture above gives each player a single game, so sigma is 0 and the
  // band collapses onto the projection — which cannot tell the two arithmetics
  // apart. These set up real spread.

  /**
   * Runs the route with both players on each roster starting, and the given
   * weekly scores. Two starters a side is the minimum that can distinguish
   * combining variances from adding floors.
   */
  async function bandRun(scores: Record<string, number[]>) {
    const { leagueId, userId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(users   as never)
      .mockResolvedValueOnce(matchupsRaw.map((m) => ({
        ...m, starters: m.players,
      })) as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMap as never);
    mockGroupBy.mockResolvedValue([] as never);
    mockGetWeather.mockResolvedValue(null as never);
    // Two findMany calls in order: the rostered players' rows, then every row in
    // the window for the positional baselines. An empty baseline keeps these
    // cases on the plain mean and spread, so they measure the band arithmetic
    // rather than the shrinkage that sits in front of it — that has its own
    // tests below.
    mockFindMany
      .mockResolvedValueOnce(
        Object.entries(scores).flatMap(([playerId, pts]) =>
          pts.map((p, i) => ({
            playerId, week: i + 3, position: 'RB', fantasyPoints: p, receptions: 0,
          })),
        ) as never,
      )
      .mockResolvedValue([] as never);
    const res = await GET(makeReq(leagueId, userId));
    return await res.json() as {
      myTeam: { projected: number; floor: number; ceiling: number; sigma: number };
      opponent: { floor: number; ceiling: number };
      myPlayers: { playerId: string; sigma: number; floor: number; ceiling: number }[];
      narrative: string;
    };
  }

  // WHY: the whole point of the fix. Two starters at mean 15 (sigma 5) and mean
  //      30 (sigma 10) combine to sigma sqrt(25+100) = 11.18, so the band is
  //      45 +/- 14.31. Adding their own floors and ceilings would give
  //      25.8-64.2 — a band 38 wide where it should be 28.6.
  it('builds the team band from combined variance, not summed floors', async () => {
    const json = await bandRun({
      '00-gsis-a':  [10, 20],   // mean 15, sigma 5
      '00-gsis-ba': [20, 40],   // mean 30, sigma 10
      '00-gsis-b':  [10, 10],
      '00-gsis-bb': [10, 10],
    });

    expect(json.myTeam.projected).toBe(45);
    expect(json.myTeam.sigma).toBeCloseTo(11.18, 2);
    expect(json.myTeam.floor).toBeCloseTo(30.7, 1);
    expect(json.myTeam.ceiling).toBeCloseTo(59.3, 1);

    // The values the old arithmetic produced, pinned so a revert is loud.
    expect(json.myTeam.floor).not.toBeCloseTo(25.8, 1);
    expect(json.myTeam.ceiling).not.toBeCloseTo(64.2, 1);
  });

  // WHY: a band is only as good as the spread it is built from, and sigma cannot
  //      be read back off floor/ceiling — the floor is clamped at 0, so for a
  //      volatile low-scorer the visible band is narrower than the real spread.
  //      Carrying it explicitly is what keeps the team band honest.
  it('carries each player sigma, recoverable or not', async () => {
    const json = await bandRun({
      '00-gsis-a':  [0, 10],    // mean 5, sigma 5 — floor clamps to 0
      '00-gsis-ba': [20, 40],
      '00-gsis-b':  [10, 10],
      '00-gsis-bb': [10, 10],
    });

    const a = json.myPlayers.find((p) => p.playerId === 'player-a')!;
    expect(a.sigma).toBeCloseTo(5, 2);
    expect(a.floor).toBe(0);                       // clamped
    // Reading sigma back off the visible band would understate it by ~22%.
    expect((a.ceiling - a.floor) / (2 * 1.28)).toBeLessThan(a.sigma);
  });

  // WHY: the team floor is a percentile of a total that cannot go negative. Two
  //      boom-or-bust starters (0, 0, 30 each) project 20 with a combined sigma
  //      of 20, so the raw 10th percentile is -5.6.
  it('clamps the team floor at zero', async () => {
    const json = await bandRun({
      '00-gsis-a':  [0, 0, 30], // mean 10, sigma 14.14
      '00-gsis-ba': [0, 0, 30],
      '00-gsis-b':  [10, 10, 10],
      '00-gsis-bb': [10, 10, 10],
    });
    expect(json.myTeam.projected).toBe(20);
    expect(json.myTeam.sigma).toBeCloseTo(20, 1);
    expect(json.myTeam.floor).toBe(0);             // 20 - 25.6 clamped
    expect(json.myTeam.ceiling).toBeCloseTo(45.6, 1);
  });

  // WHY: the knock-on. The "strong favourite" line fires when your floor clears
  //      their ceiling, which the inflated bands made effectively unreachable —
  //      under the old arithmetic this same matchup produced floor 74.4 against
  //      ceiling 85.6 and silently took the underdog branch instead.
  it('reaches the strong-favourite narrative that inflated bands blocked', async () => {
    const json = await bandRun({
      '00-gsis-a':  [40, 60],   // mean 50, sigma 10
      '00-gsis-ba': [40, 60],
      '00-gsis-b':  [20, 40],   // mean 30, sigma 10
      '00-gsis-bb': [20, 40],
    });

    expect(json.myTeam.floor).toBeCloseTo(81.9, 1);
    expect(json.opponent.ceiling).toBeCloseTo(78.1, 1);
    expect(json.myTeam.floor).toBeGreaterThan(json.opponent.ceiling);
    expect(json.narrative).toContain('strong favourite');
  });

  // ── Thin samples ────────────────────────────────────────────────────────────

  /**
   * Runs the route with a chosen set of player rows and a chosen baseline
   * population. The two findMany calls are the rostered players' rows and then
   * every row in the window, in that order.
   */
  async function thinRun(
    playerRows: object[],
    baselinePop: object[],
  ) {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockFindMany
      .mockResolvedValueOnce(playerRows as never)
      .mockResolvedValue(baselinePop as never);

    const res = await GET(makeReq(leagueId, userId));
    return await res.json() as {
      myPlayers: { playerId: string; floor: number; ceiling: number; projected: number; games: number }[];
    };
  }

  /** A population of QBs with real spread, for the baseline to be built from. */
  const qbPopulation = ['p1', 'p2', 'p3'].flatMap((playerId) =>
    [6, 14, 22].map((pts, i) => ({
      playerId, week: i + 3, position: 'QB', fantasyPoints: pts, receptions: 0,
    })),
  );

  // WHY: the reported bug. stdDev returns 0 below two values, so one game gave
  //      floor = ceiling = mean — the least-known player on the panel carrying
  //      the most confident number on it.
  it('does not report a single game as a certainty', async () => {
    const json = await thinRun(
      [{ playerId: '00-gsis-a', week: 4, position: 'QB', fantasyPoints: 2.7, receptions: 0 }],
      qbPopulation,
    );

    const p = json.myPlayers.find((x) => x.playerId === 'player-a')!;
    expect(p.games).toBe(1);
    expect(p.ceiling).toBeGreaterThan(p.floor);
    expect(p.ceiling - p.floor).toBeGreaterThan(5);
  });

  // WHY: no games at all is not a claim that the player will score nothing. It
  //      used to render 0.0-0.0, which reads as a prediction rather than as an
  //      absence of one.
  it('projects a player with no games from his position, not as zero', async () => {
    const json = await thinRun([], qbPopulation);

    const p = json.myPlayers.find((x) => x.playerId === 'player-a')!;
    expect(p.games).toBe(0);
    expect(p.projected).toBeGreaterThan(0);
    expect(p.ceiling).toBeGreaterThan(p.floor);
  });

  // WHY: the sample size is what tells a reader whether a number was observed or
  //      inferred, and it is how a player who *should* have a record but shows
  //      none stays visible as a data problem rather than as a quiet estimate.
  it('reports how many games each projection rests on', async () => {
    const json = await thinRun(
      [
        { playerId: '00-gsis-a', week: 3, position: 'QB', fantasyPoints: 10, receptions: 0 },
        { playerId: '00-gsis-a', week: 4, position: 'QB', fantasyPoints: 20, receptions: 0 },
        { playerId: '00-gsis-ba', week: 4, position: 'RB', fantasyPoints: 12, receptions: 0 },
      ],
      qbPopulation,
    );

    expect(json.myPlayers.find((x) => x.playerId === 'player-a')?.games).toBe(2);
    expect(json.myPlayers.find((x) => x.playerId === 'bench-a')?.games).toBe(1);
  });

  // WHY: shrinkage must fade. A player with a full window should project as
  //      himself — otherwise every projection drifts toward the positional mean.
  it('leaves a full sample close to the player own record', async () => {
    const observed = [24, 26, 25, 27, 24, 26];   // mean 25, far above the QB prior
    const json = await thinRun(
      observed.map((pts, i) => ({
        playerId: '00-gsis-a', week: i + 13, position: 'QB', fantasyPoints: pts, receptions: 0,
      })),
      qbPopulation,
    );

    const p = json.myPlayers.find((x) => x.playerId === 'player-a')!;
    expect(p.games).toBe(6);
    expect(p.projected).toBeGreaterThan(21);
  });

  // ── Weather is context, not an adjustment ───────────────────────────────────

  // WHY: a weather multiplier used to scale floor, ceiling and projection here,
  //      keyed on each player's own home stadium rather than the venue — so a
  //      player on the road was adjusted for a city he was not in. It is now
  //      reported in the context card and applied to nothing.
  it('leaves the projection untouched in bad weather', async () => {
    const { leagueId, userId } = freshIds();

    // Josh Allen is a passer in the fixtures, the position the old multiplier
    // hit hardest: 0.92 for wind over 20mph, times 0.95 for rain over 60%.
    const observed = [10, 20, 15, 25, 12, 18];   // mean 16.67
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(users   as never)
      .mockResolvedValueOnce(matchupsRaw as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMap as never);
    mockGroupBy.mockResolvedValue([] as never);
    mockFindMany
      .mockResolvedValueOnce(observed.map((pts, i) => ({
        playerId: '00-gsis-a', week: i + 13, position: 'QB',
        fantasyPoints: pts, receptions: 0,
      })) as never)
      .mockResolvedValue([] as never);
    mockGames.mockResolvedValue([{
      homeTeam: 'BUF', awayTeam: 'BAL', kickoff: '2026-09-13T13:00',
      stadium: 'Highmark Stadium', roof: 'outdoors', location: 'Home',
    }] as never);
    mockGetWeather.mockResolvedValue({
      team: 'BUF', tempF: 18, windMph: 30, precipPct: 80,
      stadiumName: 'Highmark Stadium', note: 'High wind; rain likely',
    } as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      myPlayers: { playerId: string; projected: number; context: { weather: unknown } }[];
    };

    const allen = json.myPlayers.find((p) => p.playerId === 'player-a')!;
    // The raw mean, not 16.67 × 0.92 × 0.95 = 14.6.
    expect(allen.projected).toBeCloseTo(16.7, 1);
    // Still reported, just not applied.
    expect(allen.context.weather).not.toBeNull();
  });

  // WHY: the narrative used to describe weather at the players' home grounds.
  //      It now speaks about the venues they are actually at.
  it('mentions weather from the venue in the narrative', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockGames.mockResolvedValue([{
      homeTeam: 'BUF', awayTeam: 'BAL', kickoff: null,
      stadium: 'Highmark Stadium', roof: 'outdoors', location: 'Home',
    }] as never);
    mockGetWeather.mockResolvedValue({
      team: 'BUF', tempF: 30, windMph: 32, precipPct: 20,
      stadiumName: 'Highmark Stadium', note: 'High wind (32 mph)',
    } as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { narrative: string };
    expect(json.narrative).toContain('Weather may be a factor');
    expect(json.narrative).toContain('32 mph');
  });
});
