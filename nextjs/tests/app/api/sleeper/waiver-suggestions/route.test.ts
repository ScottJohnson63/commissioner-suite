// tests/app/api/sleeper/waiver-suggestions/route.test.ts
//
// GET /api/sleeper/waiver-suggestions?leagueId=&userId=
//
// Scans the user's roster for positional weaknesses, then surfaces the best
// available (un-rostered) players from the trending waiver wire.
// Results are cached 10 minutes in live mode.
//
// ── Rate-limit context ────────────────────────────────────────────────────────
// Sleeper docs: stay under 1000 req/min globally; no per-endpoint limit.
// The route makes up to 3 Sleeper calls per request (rosters, NFL state,
// trending). The RouteCache prevents re-fetching within 10 minutes — a key
// protection against dashboard refresh storms. Tests verify this explicitly.
//
// Mocks:
//   @/lib/sleeper/client       — sleeperGet  (rosters + NFL state + trending)
//   @/lib/sleeper/playerCache  — getPlayerMapSafe
//   @/lib/prisma               — nflWeeklyStat.findMany, nflGame.findMany
//   @/lib/sleeper/lineup       — getStarterSlots
//   @/lib/weather              — getVenueWeather
//   @/lib/odds                 — getNflOdds

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

jest.mock('@/lib/prisma', () => ({
  prisma: {
    nflWeeklyStat: {
      findMany:  jest.fn(),
      groupBy:   jest.fn(),
      aggregate: jest.fn(),
    },
    // Fixtures for the context card each suggestion now carries. Empty by
    // default: the context is read-only and must never change a number beside
    // it, so the cases below are unaffected by it.
    nflGame: {
      findMany: jest.fn(),
    },
  },
}));

// Mocked as a module for the same reason scoringSettings is: it reads the
// `/league/{id}` payload through sleeperGet, and a third call would shift the
// queued response sequence the fixtures depend on.
// A standard Sleeper lineup — one QB, two RB, two WR, one TE, one K.
jest.mock('@/lib/sleeper/lineup', () => ({
  getStarterSlots: jest.fn(async () => ({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1 })),
}));

jest.mock('@/lib/weather', () => ({
  getWeather:      jest.fn(),
  // What the context layer calls. Never reached while nflGame is empty, since
  // there is no venue to forecast for.
  getVenueWeather: jest.fn(),
}));

jest.mock('@/lib/odds', () => ({
  getNflOdds: jest.fn(),
}));

import { GET } from '@/app/api/sleeper/waiver-suggestions/route';
import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import { getPlayerMapSafe } from '@/lib/sleeper/playerCache';
import { prisma } from '@/lib/prisma';
import { clearStatsSeasonCache } from '@/lib/statsSeason';
import { clearGsisXrefCache } from '@/lib/sleeper/gsisXref';
import { clearWindowRowsCache } from '@/lib/formWindow';

const mockSleeperGet   = sleeperGet   as jest.MockedFunction<typeof sleeperGet>;
const mockGetPlayerMap = getPlayerMapSafe as jest.MockedFunction<typeof getPlayerMapSafe>;
const mockFindMany     = prisma.nflWeeklyStat.findMany as jest.MockedFunction<typeof prisma.nflWeeklyStat.findMany>;
const mockAggregate    = prisma.nflWeeklyStat.aggregate as jest.MockedFunction<typeof prisma.nflWeeklyStat.aggregate>;
const mockGroupBy      = prisma.nflWeeklyStat.groupBy as jest.MockedFunction<typeof prisma.nflWeeklyStat.groupBy>;
const mockGames        = prisma.nflGame.findMany as jest.MockedFunction<typeof prisma.nflGame.findMany>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

// User uid-1 owns roster 1 (a QB-heavy, TE-weak roster).
const rosters = [
  { roster_id: 1, owner_id: 'uid-1', players: ['qb-1', 'qb-2'], settings: { wins: 5, losses: 3 } },
  { roster_id: 2, owner_id: 'uid-2', players: ['rb-1', 'rb-2'], settings: { wins: 4, losses: 4 } },
];

// A trending player (un-rostered TE) that should surface as a waiver suggestion.
const trendingRaw = [
  { player_id: 'te-available', count: 5200 },
  { player_id: 'qb-1',         count: 1000 }, // already rostered — must be filtered out
];

// Player map covering both rostered and available players.
// gsisId is what NflWeeklyStat is keyed on. Sleeper populates it for a minority
// of players in reality, so one entry here deliberately leaves it null — that
// player is only reachable through the name fallback in gsisXref.
const playerMapData = new Map([
  ['qb-1',         { name: 'Patrick Mahomes', position: 'QB', team: 'KC',  gsisId: '00-gsis-qb-1' }],
  ['qb-2',         { name: 'Josh Allen',      position: 'QB', team: 'BUF', gsisId: '00-gsis-qb-2' }],
  ['rb-1',         { name: 'Saquon Barkley',  position: 'RB', team: 'PHI', gsisId: '00-gsis-rb-1' }],
  ['rb-2',         { name: 'Derrick Henry',   position: 'RB', team: 'TEN', gsisId: null           }],
  ['te-available', { name: 'Tucker Kraft',    position: 'TE', team: 'GB',  gsisId: '00-gsis-te-1' }],
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

let seq = 0;
function freshIds() {
  seq++;
  return { leagueId: `league-wv-${seq}`, userId: 'uid-1' };
}

function makeReq(leagueId: string, userId: string, week = '5'): NextRequest {
  const params = new URLSearchParams({ leagueId, userId, season: '2025', week });
  return new NextRequest(`http://localhost/api/sleeper/waiver-suggestions?${params}`);
}

// Sets up the two sleeperGet calls made by the live branch when ?week= is provided.
// makeReq() always includes week=5, so the route skips the /state/nfl call and
// goes straight to the Promise.all([rosters, trending, playerMap]) fetch.
//   1. League rosters
//   2. Trending adds (168-hour window)
function setupHappyPath(): void {
  mockSleeperGet
    .mockResolvedValueOnce(rosters as never)       // /league/{id}/rosters
    .mockResolvedValueOnce(trendingRaw as never);  // /players/nfl/trending/add
  mockGetPlayerMap.mockResolvedValueOnce(playerMapData as never);
  mockFindMany.mockResolvedValue([] as never);     // no DB stats → mockAvg fallback
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/sleeper/waiver-suggestions', () => {
  beforeEach(() => {
    mockSleeperGet.mockReset();
    mockGetPlayerMap.mockReset();
    mockFindMany.mockReset();
    mockGroupBy.mockReset();
    mockAggregate.mockReset();
    mockGames.mockReset();
    // No fixtures unless a test supplies them — see the prisma mock above.
    mockGames.mockResolvedValue([] as never);
    // Safe defaults — getPlayerMapSafe is called with .catch() in the route.
    // Without a Promise-returning default, the .catch() call crashes the worker.
    mockGetPlayerMap.mockResolvedValue(new Map() as never);
    mockFindMany.mockResolvedValue([] as never);
    // The gsisXref name index; every fixture player carries a gsisId bar one,
    // and that one is meant to stay unresolved.
    mockGroupBy.mockResolvedValue([] as never);
    // The requested season has rows through week 5, so no season fallback.
    mockAggregate.mockResolvedValue({ _max: { week: 5 } } as never);
    // All three memoise across calls; each test starts clean.
    clearStatsSeasonCache();
    clearGsisXrefCache();
    clearWindowRowsCache();
  });

  // WHY: leagueId is required to fetch rosters — without it no Sleeper call can
  //      be constructed. Fail fast before any IO.
  it('returns 400 when leagueId is missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/sleeper/waiver-suggestions?userId=uid-1'));
    expect(res.status).toBe(400);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });

  // WHY: userId is required to identify the user's roster among all league rosters.
  it('returns 400 when userId is missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/sleeper/waiver-suggestions?leagueId=l1'));
    expect(res.status).toBe(400);
  });

  // WHY: If the userId doesn't match any roster, the user may have left the
  //      league — return 404 rather than return empty suggestions silently.
  it('returns 404 when the user has no roster in the league', async () => {
    const { leagueId } = freshIds();
    // ?week=5 in makeReq skips the /state/nfl call — only rosters + trending needed.
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(trendingRaw as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMapData as never);
    mockFindMany.mockResolvedValue([] as never);

    const res = await GET(makeReq(leagueId, 'uid-nobody'));
    expect(res.status).toBe(404);
  });

  // WHY: The response must contain the expected top-level keys:
  //      weakPositions (array of positions below league median) and suggestions.
  it('returns 200 with weakPositions and suggestions on success', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res = await GET(makeReq(leagueId, userId));
    // ok() returns data directly (no { data: ... } wrapper)
    const json = await res.json() as { weakPositions: string[]; suggestions: unknown[] };

    expect(res.status).toBe(200);
    expect(Array.isArray(json.weakPositions)).toBe(true);
    expect(Array.isArray(json.suggestions)).toBe(true);
  });

  // WHY: Already-rostered players must never appear in the waiver suggestions —
  //      a player who is already on any team's roster is unavailable.
  //      trendingRaw includes qb-1 (rostered by uid-1) — it must be filtered out.
  it('excludes already-rostered players from suggestions', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { suggestions: { playerId: string }[] };

    const suggestedIds = json.suggestions.map((s) => s.playerId);
    expect(suggestedIds).not.toContain('qb-1');  // already rostered
    expect(suggestedIds).not.toContain('qb-2');  // already rostered
  });


  // ── Stat lookup: Sleeper IDs vs GSIS IDs ────────────────────────────────────

  // WHY: this is the bug that made live mode look plausible and be empty. Rosters
  //      and the trending feed are Sleeper IDs; NflWeeklyStat is keyed on GSIS
  //      IDs. Querying with the former returns no rows, and no rows reads as
  //      "every player averaged zero" — which is exactly what the panel showed.
  it('matches stat rows by GSIS ID, never by Sleeper ID', async () => {
    const { leagueId, userId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(trendingRaw as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMapData as never);
    // Two rows for the same player: one under his GSIS ID, one under his Sleeper
    // ID. Only the first is his. A route that matched on Sleeper IDs would score
    // him 100, and one that matched on both would average the two to 60.
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return [
        { playerId: '00-gsis-te-1',  position: 'TE', fantasyPoints: 20,  receptions: 0 },
        { playerId: 'te-available',  position: 'TE', fantasyPoints: 100, receptions: 0 },
      ];
    }) as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { suggestions: { playerId: string; recentAvg: number; games: number }[] };

    const kraft = json.suggestions.find((x) => x.playerId === 'te-available');
    expect(kraft?.recentAvg).toBe(20);
    expect(kraft?.games).toBe(1);
  });

  // WHY: the positional-weakness test compares my best starter against the league
  //      median. Looking up only my players leaves every other roster at zero, so
  //      the median is zero and no position is ever weak.
  it('reads the whole window, so no roster and no free agent is left out', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    await GET(makeReq(leagueId, userId));

    const statsCall = mockFindMany.mock.calls.find(
      (c) => (c[0] as { where?: { week?: unknown } })?.where?.week !== undefined,
    );
    const where = (statsCall?.[0] as { where: { playerId?: unknown; seasonType: string } }).where;

    // No player filter at all. The old query narrowed to the players on the page,
    // which is a couple of thousand IDs once the pool is every free agent — more
    // than SQLite will bind, and slower than reading the window it was carved
    // out of.
    expect(where.playerId).toBeUndefined();
    expect(where.seasonType).toBe('REG');
  });

  // WHY: rows come back keyed on GSIS IDs, and the suggestion rows the UI renders
  //      are keyed on Sleeper IDs. Skipping the map back leaves the averages
  //      attached to IDs nothing else in the response uses.
  it('maps returned stat rows back onto Sleeper IDs', async () => {
    const { leagueId, userId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(trendingRaw as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMapData as never);
    mockFindMany.mockResolvedValue([
      { playerId: '00-gsis-te-1', position: 'TE', fantasyPoints: 18, receptions: 0 },
      { playerId: '00-gsis-te-1', position: 'TE', fantasyPoints: 12, receptions: 0 },
    ] as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { suggestions: { playerId: string; recentAvg: number }[] };

    const kraft = json.suggestions.find((x) => x.playerId === 'te-available');
    expect(kraft?.recentAvg).toBe(15);
  });

  // ── The free-agent scan ─────────────────────────────────────────────────────

  // A pool that is not the trending feed: one un-rostered WR who is producing
  // and whom nobody is adding, one who is producing but has no NFL team, and one
  // who has an NFL team and no record.
  const scanPlayers = new Map([
    ['qb-1',         { name: 'Patrick Mahomes', position: 'QB', team: 'KC',  gsisId: '00-gsis-qb-1' }],
    ['qb-2',         { name: 'Josh Allen',      position: 'QB', team: 'BUF', gsisId: '00-gsis-qb-2' }],
    ['rb-1',         { name: 'Saquon Barkley',  position: 'RB', team: 'PHI', gsisId: '00-gsis-rb-1' }],
    ['rb-2',         { name: 'Derrick Henry',   position: 'RB', team: 'TEN', gsisId: null           }],
    ['te-available', { name: 'Tucker Kraft',    position: 'TE', team: 'GB',  gsisId: '00-gsis-te-1' }],
    // Producing, un-rostered, and absent from the trending feed entirely.
    ['wr-quiet',     { name: 'Quiet Riser',     position: 'WR', team: 'CAR', gsisId: '00-gsis-wr-q' }],
    // Producing on paper but on nobody's NFL roster — cannot play, cannot help.
    ['wr-teamless',  { name: 'Free Agent Guy',  position: 'WR', team: null,  gsisId: '00-gsis-wr-t' }],
    // On an NFL team, never played in the window, and nobody is adding him.
    ['wr-idle',      { name: 'Third String',    position: 'WR', team: 'NYJ', gsisId: '00-gsis-wr-i' }],
  ]);

  function setupScan(): void {
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(trendingRaw as never);
    mockGetPlayerMap.mockResolvedValueOnce(scanPlayers as never);
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return [
        { playerId: '00-gsis-wr-q', position: 'WR', fantasyPoints: 22, receptions: 0 },
        { playerId: '00-gsis-wr-q', position: 'WR', fantasyPoints: 20, receptions: 0 },
        { playerId: '00-gsis-wr-t', position: 'WR', fantasyPoints: 30, receptions: 0 },
        { playerId: '00-gsis-wr-t', position: 'WR', fantasyPoints: 30, receptions: 0 },
      ];
    }) as never);
  }

  // WHY: this is the point of the scan. The trending feed is a ranking of the
  //      players most clicked on across every Sleeper league — a popularity list
  //      from other people's leagues. A back producing quietly on a bad team
  //      never appears in it, so the panel could not see him however well he was
  //      playing, whatever the gap on the roster asking.
  it('surfaces a producing free agent nobody is adding', async () => {
    const { leagueId, userId } = freshIds();
    setupScan();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      suggestions: { playerId: string; recentAvg: number; trendingCount: number | null }[];
    };

    const quiet = json.suggestions.find((x) => x.playerId === 'wr-quiet');
    expect(quiet).toBeDefined();
    expect(quiet?.recentAvg).toBe(21);
    // Not in the trending feed at all — he is here on his record alone.
    expect(quiet?.trendingCount).toBeNull();
  });

  // WHY: Sleeper leaves `team` null for a player on no NFL roster. He cannot
  //      score whatever the window says about the games he did play, so
  //      suggesting him is worse than suggesting nobody.
  it('excludes a player with no NFL team, however well he scored', async () => {
    const { leagueId, userId } = freshIds();
    setupScan();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { suggestions: { playerId: string }[] };

    // He outscores everyone in the window and must still not be suggested.
    expect(json.suggestions.map((x) => x.playerId)).not.toContain('wr-teamless');
  });

  // WHY: most of a free-agent pool has never taken a snap. `project` returns the
  //      positional prior when it has nothing else, so ranking them anyway would
  //      put a third-string receiver at what a receiver typically scores — a
  //      thousand players recommended on the strength of their position.
  it('excludes a player with no games and no one adding him', async () => {
    const { leagueId, userId } = freshIds();
    setupScan();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { suggestions: { playerId: string }[] };

    expect(json.suggestions.map((x) => x.playerId)).not.toContain('wr-idle');
  });

  // WHY: the trending feed stays as the one on-ramp for a player the window
  //      cannot speak for — a back promoted on Wednesday has no games and
  //      several thousand adds. He belongs on the list, below everyone with a
  //      record rather than ranked on a prior he did not earn.
  it('keeps a trending player with no record, ranked below anyone who has one', async () => {
    const { leagueId, userId } = freshIds();
    setupScan();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      suggestions: { playerId: string; games: number; reason: string }[];
    };

    const ids = json.suggestions.map((x) => x.playerId);
    // te-available has no rows in the window and 5,200 adds.
    expect(ids).toContain('te-available');
    expect(ids.indexOf('wr-quiet')).toBeLessThan(ids.indexOf('te-available'));
    expect(json.suggestions.find((x) => x.playerId === 'te-available')?.reason)
      .toContain('No games');
  });

  // ── The returned list: volume, mix, and trending ────────────────────────────

  /** A pool shaped like the real one — receivers outnumber everyone else. */
  function setupPool(): void {
    const mix = ['WR','WR','WR','WR','RB','RB','RB','WR','TE','QB','WR','RB','K','WR','RB'];
    const players = new Map<string, { name: string; position: string; team: string | null; gsisId: string }>();
    for (let i = 0; i < 300; i++) {
      players.set(`fa-${i}`, {
        name: `Free Agent ${i}`, position: mix[i % mix.length],
        team: 'KC', gsisId: `00-fa-${i}`,
      });
    }
    // One roster, so nothing in the pool is owned.
    mockSleeperGet
      .mockResolvedValueOnce([{ roster_id: 1, owner_id: 'uid-1', players: [] }] as never)
      .mockResolvedValueOnce([] as never);
    mockGetPlayerMap.mockResolvedValueOnce(players as never);
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return Array.from({ length: 300 }, (_, i) => ([
        { playerId: `00-fa-${i}`, position: mix[i % mix.length], fantasyPoints: 20 - (i % 19), receptions: 0 },
        { playerId: `00-fa-${i}`, position: mix[i % mix.length], fantasyPoints: 18 - (i % 17), receptions: 0 },
      ])).flat();
    }) as never);
  }

  // WHY: eight rows was the whole answer when the pool was fifty trending names.
  //      Against a real free-agent pool it is a keyhole, and which eight showed
  //      depended entirely on the ranking being right.
  it('returns a full page-through list rather than a handful', async () => {
    const { leagueId } = freshIds();
    setupPool();

    const res  = await GET(makeReq(leagueId, 'uid-1'));
    const json = await res.json() as { suggestions: unknown[]; scanned: number };

    expect(json.suggestions).toHaveLength(100);
    expect(json.scanned).toBeGreaterThan(100);
  });

  // WHY: sorted purely by score the list is honest and useless to page through.
  //      Receivers outnumber every other position and score in the same range,
  //      so the first two screens are receivers and the reader never reaches the
  //      one tight end worth having.
  it('mixes positions rather than leading with the deepest one', async () => {
    const { leagueId } = freshIds();
    setupPool();

    const res  = await GET(makeReq(leagueId, 'uid-1'));
    const json = await res.json() as { suggestions: { position: string }[] };

    // The first page the panel renders.
    const firstPage = json.suggestions.slice(0, 10).map((s) => s.position);
    expect(new Set(firstPage).size).toBeGreaterThanOrEqual(4);

    // And no single position swamps the list, however deep the pool is in it.
    const counts = new Map<string, number>();
    for (const s of json.suggestions) counts.set(s.position, (counts.get(s.position) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(30);
  });

  // WHY: the trending feed is back in the ranking rather than sitting on the row
  //      as decoration. Several thousand managers adding someone this week is
  //      real information about a job change the stat window has not caught up
  //      with, and it should be able to move a player up the list.
  it('lets add volume lift a player over a slightly better producer', async () => {
    const { leagueId } = freshIds();
    const players = new Map([
      ['wr-hot',  { name: 'Just Promoted', position: 'WR', team: 'KC',  gsisId: '00-wr-hot'  }],
      ['wr-cold', { name: 'Nobody Wants',  position: 'WR', team: 'BUF', gsisId: '00-wr-cold' }],
    ]);
    mockSleeperGet
      .mockResolvedValueOnce([{ roster_id: 1, owner_id: 'uid-1', players: [] }] as never)
      // wr-hot is the most-added player in the league this week.
      .mockResolvedValueOnce([{ player_id: 'wr-hot', count: 9000 }] as never);
    mockGetPlayerMap.mockResolvedValueOnce(players as never);
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return [
        // The cold player is the better producer, but only just.
        { playerId: '00-wr-cold', position: 'WR', fantasyPoints: 12, receptions: 0 },
        { playerId: '00-wr-cold', position: 'WR', fantasyPoints: 12, receptions: 0 },
        { playerId: '00-wr-hot',  position: 'WR', fantasyPoints: 11, receptions: 0 },
        { playerId: '00-wr-hot',  position: 'WR', fantasyPoints: 11, receptions: 0 },
      ];
    }) as never);

    const res  = await GET(makeReq(leagueId, 'uid-1'));
    const json = await res.json() as {
      suggestions: { playerId: string; recentAvg: number; trendingCount: number | null }[];
    };

    const ids = json.suggestions.map((s) => s.playerId);
    expect(ids.indexOf('wr-hot')).toBeLessThan(ids.indexOf('wr-cold'));
    // The averages still report what each did — the adds moved the order, not
    // the numbers.
    expect(json.suggestions.find((s) => s.playerId === 'wr-hot')?.recentAvg).toBe(11);
    expect(json.suggestions.find((s) => s.playerId === 'wr-hot')?.trendingCount).toBe(9000);
  });

  // WHY: bounded, not decisive. A week of hype must not outrank a genuinely
  //      better player — the add count orders the list, it does not decide it.
  it('does not let add volume outrank a genuinely better player', async () => {
    const { leagueId } = freshIds();
    const players = new Map([
      ['wr-hot',  { name: 'Hyped',      position: 'WR', team: 'KC',  gsisId: '00-wr-hot'  }],
      ['wr-good', { name: 'Much Better', position: 'WR', team: 'BUF', gsisId: '00-wr-good' }],
    ]);
    mockSleeperGet
      .mockResolvedValueOnce([{ roster_id: 1, owner_id: 'uid-1', players: [] }] as never)
      .mockResolvedValueOnce([{ player_id: 'wr-hot', count: 9000 }] as never);
    mockGetPlayerMap.mockResolvedValueOnce(players as never);
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return [
        { playerId: '00-wr-good', position: 'WR', fantasyPoints: 20, receptions: 0 },
        { playerId: '00-wr-good', position: 'WR', fantasyPoints: 20, receptions: 0 },
        { playerId: '00-wr-hot',  position: 'WR', fantasyPoints: 8,  receptions: 0 },
        { playerId: '00-wr-hot',  position: 'WR', fantasyPoints: 8,  receptions: 0 },
      ];
    }) as never);

    const res  = await GET(makeReq(leagueId, 'uid-1'));
    const json = await res.json() as { suggestions: { playerId: string }[] };

    const ids = json.suggestions.map((s) => s.playerId);
    expect(ids.indexOf('wr-good')).toBeLessThan(ids.indexOf('wr-hot'));
  });

  // WHY: the panel pages through the list and says what was searched to build
  //      it. The count has to be the pool actually ranked, not the page.
  it('reports how many free agents were ranked', async () => {
    const { leagueId, userId } = freshIds();
    setupScan();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { scanned: number; suggestions: unknown[] };

    // wr-quiet (a record) and te-available (adds, no record). wr-teamless has no
    // NFL team and wr-idle has neither a record nor adds.
    expect(json.scanned).toBe(2);
    expect(json.suggestions).toHaveLength(2);
  });

  // WHY: over a pool this size the raw average fills the panel with players who
  //      had one good afternoon — 22 once outranks 18 across three weeks, and
  //      there are far more of the former than the latter. Ranking on the
  //      projected mean shrinks a thin sample toward what the position does, and
  //      the order inverts: 14.0 against 14.8.
  it('ranks a sustained record above a one-game outlier', async () => {
    const { leagueId } = freshIds();
    const twoWrs = new Map([
      ['qb-1',      { name: 'Patrick Mahomes', position: 'QB', team: 'KC',  gsisId: '00-gsis-qb-1' }],
      ['qb-2',      { name: 'Josh Allen',      position: 'QB', team: 'BUF', gsisId: '00-gsis-qb-2' }],
      ['wr-steady', { name: 'Steady Hands',    position: 'WR', team: 'CAR', gsisId: '00-wr-steady' }],
      ['wr-spike',  { name: 'One Big Day',     position: 'WR', team: 'NYJ', gsisId: '00-wr-spike'  }],
    ]);
    mockSleeperGet
      .mockResolvedValueOnce([rosters[0]] as never)
      .mockResolvedValueOnce([] as never);   // nothing trending
    mockGetPlayerMap.mockResolvedValueOnce(twoWrs as never);
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return [
        // Three weeks at 18 — an 18.0 average on a real record.
        { playerId: '00-wr-steady', position: 'WR', fantasyPoints: 18, receptions: 0 },
        { playerId: '00-wr-steady', position: 'WR', fantasyPoints: 18, receptions: 0 },
        { playerId: '00-wr-steady', position: 'WR', fantasyPoints: 18, receptions: 0 },
        // One week at 22 — a 22.0 average on one game.
        { playerId: '00-wr-spike',  position: 'WR', fantasyPoints: 22, receptions: 0 },
        // The rest of the league's receivers, which is what the positional
        // baseline is drawn from. Not in this league's player map, so they set
        // the prior (mean 10) without joining the pool.
        { playerId: '00-wr-f1', position: 'WR', fantasyPoints: 6, receptions: 0 },
        { playerId: '00-wr-f1', position: 'WR', fantasyPoints: 6, receptions: 0 },
        { playerId: '00-wr-f2', position: 'WR', fantasyPoints: 6, receptions: 0 },
        { playerId: '00-wr-f2', position: 'WR', fantasyPoints: 6, receptions: 0 },
        { playerId: '00-wr-f3', position: 'WR', fantasyPoints: 6, receptions: 0 },
        { playerId: '00-wr-f3', position: 'WR', fantasyPoints: 6, receptions: 0 },
      ];
    }) as never);

    const res  = await GET(makeReq(leagueId, 'uid-1'));
    const json = await res.json() as {
      suggestions: { playerId: string; recentAvg: number; games: number; projected: number }[];
    };

    const ids = json.suggestions.map((x) => x.playerId);
    expect(ids.indexOf('wr-steady')).toBeLessThan(ids.indexOf('wr-spike'));

    const spike  = json.suggestions.find((x) => x.playerId === 'wr-spike')!;
    const steady = json.suggestions.find((x) => x.playerId === 'wr-steady')!;
    // The averages still report what each player did — 22 is not rewritten to
    // 14. It is the ranking that refuses to read one afternoon as a rate, and
    // the game count beside it that says why.
    expect(spike.recentAvg).toBe(22);
    expect(spike.games).toBe(1);
    expect(spike.projected).toBeCloseTo(14.0, 1);
    expect(steady.projected).toBeCloseTo(14.8, 1);
  });

  // ── Season resolution ───────────────────────────────────────────────────────

  // WHY: before kickoff the live season has no rows, so the panel would score
  //      every player at zero. Reading the last season that has data is the
  //      honest baseline — and the response says so, so the UI can label it.
  it('falls back to the last season with data and flags it', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    // 2025 asked for; only 2024 has rows, through week 21.
    mockAggregate.mockImplementation((async (args: { where: { season: number } }) => ({
      _max: { week: args.where.season === 2024 ? 21 : null },
    })) as never);
    clearStatsSeasonCache();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      statsSeason: number; statsFallback: boolean;
      suggestions: { reason: string }[];
    };

    expect(json.statsSeason).toBe(2024);
    expect(json.statsFallback).toBe(true);
    // The reason string must name the season too — "last 3 wks" on its own
    // reads as this year.
    expect(json.suggestions[0]?.reason).toContain('2024');

    const statsCall = mockFindMany.mock.calls.find(
      (c) => (c[0] as { where?: { week?: unknown } })?.where?.week !== undefined,
    );
    expect((statsCall?.[0] as { where: { season: number } }).where.season).toBe(2024);
  });

  // WHY: mid-season the nflverse sync trails live play. A window ending on a week
  //      that has not been written yet comes back empty, so it is anchored on the
  //      last week that has rows instead.
  it('clamps the stat window to the last week that has rows', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockAggregate.mockResolvedValue({ _max: { week: 3 } } as never);
    clearStatsSeasonCache();

    await GET(makeReq(leagueId, userId)); // ?week=5, but only 3 weeks are synced

    const statsCall = mockFindMany.mock.calls.find(
      (c) => (c[0] as { where?: { week?: unknown } })?.where?.week !== undefined,
    );
    expect((statsCall?.[0] as { where: { week: { gte: number; lte: number } } }).where.week)
      .toEqual({ gte: 1, lte: 3 });
  });

  // WHY (regression): the window used to end on the *live* week number even when
  //      the stats came from an earlier season, so "last 3 wks" in week 3 of 2025
  //      read weeks 1-2 of 2024 — the opening of the wrong year rather than the
  //      close of it. A fallback season is complete, so its last three weeks are
  //      its most recent form and the window has to anchor on its final week.
  it('anchors the window on the END of a fallback season, not the live week', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    // 2025 asked for; only 2024 has rows, through week 18.
    mockAggregate.mockImplementation((async (args: { where: { season: number } }) => ({
      _max: { week: args.where.season === 2024 ? 18 : null },
    })) as never);
    clearStatsSeasonCache();

    await GET(makeReq(leagueId, userId)); // ?week=5 — a 2025 week number

    const statsCall = mockFindMany.mock.calls.find(
      (c) => (c[0] as { where?: { week?: unknown } })?.where?.week !== undefined,
    );
    const where = (statsCall?.[0] as { where: { season: number; week: { gte: number; lte: number } } }).where;

    expect(where.season).toBe(2024);
    // The close of 2024, not weeks 3-5 of it.
    expect(where.week).toEqual({ gte: 16, lte: 18 });
  });

  // WHY: the panel names the weeks it averaged. It used to say "last 3 wks" over
  //      a query that could cover any three, so the label is now built from the
  //      same numbers the query used.
  it('reports the exact window the averages cover', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    mockAggregate.mockResolvedValue({ _max: { week: 4 } } as never);
    clearStatsSeasonCache();

    const res  = await GET(makeReq(leagueId, userId)); // ?week=5, synced through 4
    const json = await res.json() as {
      window: { season: number; startWeek: number; endWeek: number; fallback: boolean };
    };

    expect(json.window).toEqual({ season: 2025, startWeek: 2, endWeek: 4, fallback: false });
  });

  // WHY: the window is not always three weeks wide. Early in a season, or
  //      wherever the sync has only reached week 1, there are fewer to average
  //      and a fixed "last 3 wks" caption would claim an average over weeks that
  //      have not been played.
  it('counts the weeks it actually has rather than claiming three', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();
    // 2025 is deep enough not to fall back, but only two weeks have finished.
    mockAggregate.mockResolvedValue({ _max: { week: 6 } } as never);
    clearStatsSeasonCache();

    const res  = await GET(makeReq(leagueId, userId, '2')); // week 2 is the last completed
    const json = await res.json() as {
      window: { startWeek: number; endWeek: number };
      suggestions: { reason: string }[];
    };

    expect(json.window).toMatchObject({ startWeek: 1, endWeek: 2 });
    expect(json.suggestions[0]?.reason).toContain('last 2 wks');
    expect(json.suggestions[0]?.reason).not.toContain('last 3 wks');
  });

  // ── The projection band and the context card ────────────────────────────────

  // WHY: the average alone says nothing about how firm it is. Each suggestion
  //      carries the same floor/ceiling band the matchup report shows, and the
  //      game count behind the average, so a one-game average is legible as one.
  it('carries a projection band and a game count alongside the average', async () => {
    const { leagueId, userId } = freshIds();
    mockSleeperGet
      .mockResolvedValueOnce(rosters as never)
      .mockResolvedValueOnce(trendingRaw as never);
    mockGetPlayerMap.mockResolvedValueOnce(playerMapData as never);
    // Two games, 18 and 12: mean 15, sigma 3. They are also the only rows in the
    // window, so the TE baseline is the same pair, and blending two observed
    // games with a two-game prior of the same shape leaves the mean at 15 and
    // widens sigma to sqrt(9 x 5/4) — the uncertainty in the mean itself, which
    // is what stops a two-game sample from reading as a certainty.
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return [
        { playerId: '00-gsis-te-1', position: 'TE', fantasyPoints: 18, receptions: 0 },
        { playerId: '00-gsis-te-1', position: 'TE', fantasyPoints: 12, receptions: 0 },
      ];
    }) as never);

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      suggestions: { playerId: string; recentAvg: number; games: number;
                     floor: number; ceiling: number; projected: number }[];
    };

    const kraft = json.suggestions.find((x) => x.playerId === 'te-available');
    expect(kraft?.recentAvg).toBe(15);
    expect(kraft?.games).toBe(2);
    expect(kraft?.projected).toBe(15);
    expect(kraft?.floor).toBeCloseTo(10.7, 1);
    expect(kraft?.ceiling).toBeCloseTo(19.3, 1);
  });

  // WHY: the info card the matchup report shows is the same card here, built by
  //      the same module. With no fixture synced it must still be a well-formed
  //      context the tooltip can render, not a missing field.
  it('carries a matchup-context card on every suggestion', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      suggestions: { context: { opponent: string | null; weatherNote: string | null } }[];
    };

    expect(json.suggestions.length).toBeGreaterThan(0);
    for (const s of json.suggestions) {
      expect(s.context).toBeDefined();
      // No NflGame rows in this fixture, so the card says so rather than
      // inventing a fixture.
      expect(s.context.opponent).toBeNull();
      expect(s.context.weatherNote).toContain('No fixture found');
    }
  });

  // ── Positional weakness ─────────────────────────────────────────────────────

  // WHY: the test compared each roster's single best player at a position, which
  //      is the wrong question wherever the league starts more than one. A team
  //      with an elite RB1 and nothing behind him read as strong at running back
  //      while starting a replacement-level RB2 every week.
  it('measures a position over as many players as the league starts there', async () => {
    const { leagueId } = freshIds();
    // Mine: one good RB and one who scores nothing. Theirs: two good RBs.
    // On best-player-only both rosters read 20 and nothing is weak; over the
    // two RB slots this league starts, mine averages 10 against a par of 15.
    const rbRosters = [
      { roster_id: 1, owner_id: 'uid-1', players: ['rb-1', 'rb-2'] },
      { roster_id: 2, owner_id: 'uid-2', players: ['rb-3', 'rb-4'] },
    ];
    const rbPlayers = new Map([
      ['rb-1', { name: 'RB One',   position: 'RB', team: 'PHI', gsisId: '00-rb-1' }],
      ['rb-2', { name: 'RB Two',   position: 'RB', team: 'TEN', gsisId: '00-rb-2' }],
      ['rb-3', { name: 'RB Three', position: 'RB', team: 'DAL', gsisId: '00-rb-3' }],
      ['rb-4', { name: 'RB Four',  position: 'RB', team: 'SF',  gsisId: '00-rb-4' }],
      ['te-available', { name: 'Tucker Kraft', position: 'TE', team: 'GB', gsisId: '00-gsis-te-1' }],
    ]);
    mockSleeperGet
      .mockResolvedValueOnce(rbRosters as never)
      .mockResolvedValueOnce(trendingRaw as never);
    mockGetPlayerMap.mockResolvedValueOnce(rbPlayers as never);
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return [
        { playerId: '00-rb-1', position: 'RB', fantasyPoints: 20, receptions: 0 },
        // rb-2 has no rows at all — the hole this is meant to see.
        { playerId: '00-rb-3', position: 'RB', fantasyPoints: 20, receptions: 0 },
        { playerId: '00-rb-4', position: 'RB', fantasyPoints: 20, receptions: 0 },
      ];
    }) as never);

    const res  = await GET(makeReq(leagueId, 'uid-1'));
    const json = await res.json() as { weakPositions: string[] };

    expect(json.weakPositions).toContain('RB');
  });

  // WHY (reported): a manager with two quarterbacks, one a solid starter, was
  //      told QB was his weakness. "More than 15% below the league median" was
  //      the whole test, and a percentage of the median says nothing about where
  //      a roster actually stands. Whenever the top of a position pulls away
  //      from the middle — five elite quarterbacks and everyone else, which is
  //      an ordinary season — the median rides up with them and a perfectly
  //      startable mid-table QB lands more than 15% below it. Weakness now needs
  //      the rank to agree, and the rank is the reading that survives whatever
  //      shape the position happens to have.
  it('does not call a mid-table starter weak when the top of the league pulls away', async () => {
    const { leagueId } = freshIds();
    // Ten teams. Five elite quarterbacks bunched at the top, then a gap, then
    // the rest. Mine is 17 — sixth of ten, a starter anybody would play, and
    // 17.6% below a median that only sits at 20.5 because of the five above it.
    const qbAverages = [30, 28, 26, 25, 24, 17, 16, 15, 14, 13];
    const MINE = 5; // index of the roster under test
    const qbRosters = qbAverages.map((_, i) => ({
      roster_id: i + 1,
      owner_id: `uid-${i}`,
      // Mine carries two, as reported: the starter and a backup.
      players: i === MINE ? ['qb-mine', 'qb-mine-2'] : [`qb-${i}`],
    }));
    const qbPlayers = new Map<string, { name: string; position: string; team: string | null; gsisId: string }>([
      ['qb-mine',   { name: 'My Starter', position: 'QB', team: 'KC',  gsisId: '00-qb-mine'   }],
      ['qb-mine-2', { name: 'My Backup',  position: 'QB', team: 'NYJ', gsisId: '00-qb-mine-2' }],
    ]);
    qbAverages.forEach((_, i) => {
      if (i === MINE) return;
      qbPlayers.set(`qb-${i}`, { name: `QB ${i}`, position: 'QB', team: 'BUF', gsisId: `00-qb-${i}` });
    });

    const rows = qbAverages.flatMap((pts, i) =>
      i === MINE
        ? [{ playerId: '00-qb-mine', position: 'QB', fantasyPoints: pts, receptions: 0 },
           // The backup really is poor. Taking the best of the two, rather than
           // averaging them, is why carrying a backup cannot create a weakness.
           { playerId: '00-qb-mine-2', position: 'QB', fantasyPoints: 4, receptions: 0 }]
        : [{ playerId: `00-qb-${i}`, position: 'QB', fantasyPoints: pts, receptions: 0 }]);

    mockSleeperGet
      .mockResolvedValueOnce(qbRosters as never)
      .mockResolvedValueOnce([] as never);
    mockGetPlayerMap.mockResolvedValueOnce(qbPlayers as never);
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return rows;
    }) as never);

    const res  = await GET(makeReq(leagueId, `uid-${MINE}`));
    const json = await res.json() as {
      weakPositions: string[];
      positionNeeds: { position: string; mine: number; median: number; rank: number; of: number }[];
    };

    const qb = json.positionNeeds.find((n) => n.position === 'QB')!;
    // Carrying a backup does not drag the group down: the group is the starter.
    expect(qb.mine).toBe(17);
    expect(qb.median).toBe(20.5);
    // The old test, kept in the fixture on purpose — this is the exact condition
    // that produced the false flag, and it is still true.
    expect(qb.mine).toBeLessThan(qb.median * 0.85);
    // The rank disagrees, and the rank is what decides.
    expect(qb.rank).toBe(6);
    expect(qb.of).toBe(10);
    expect(json.weakPositions).not.toContain('QB');
  });

  // WHY: a roster whose players have no games in the window is a hole in the
  //      data — an unsynced week, a name the stat table files differently, a
  //      season fallback that predates the player — not a hole in the roster.
  //      Calling that a weakness sends someone to drop a starter over it.
  it('reports a position with no games as unmeasured rather than weak', async () => {
    const { leagueId } = freshIds();
    const qbRosters = [
      { roster_id: 1, owner_id: 'uid-1', players: ['qb-unknown'] },
      { roster_id: 2, owner_id: 'uid-2', players: ['qb-known'] },
    ];
    const qbPlayers = new Map([
      // Nothing in the stat window resolves to this player at all.
      ['qb-unknown', { name: 'Unresolved QB', position: 'QB', team: 'KC',  gsisId: '00-qb-unknown' }],
      ['qb-known',   { name: 'Known QB',      position: 'QB', team: 'BUF', gsisId: '00-qb-known'   }],
    ]);
    mockSleeperGet
      .mockResolvedValueOnce(qbRosters as never)
      .mockResolvedValueOnce([] as never);
    mockGetPlayerMap.mockResolvedValueOnce(qbPlayers as never);
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return [{ playerId: '00-qb-known', position: 'QB', fantasyPoints: 22, receptions: 0 }];
    }) as never);

    const res  = await GET(makeReq(leagueId, 'uid-1'));
    const json = await res.json() as {
      weakPositions: string[];
      positionNeeds: { position: string; unmeasured: boolean; weak: boolean; games: number }[];
    };

    const qb = json.positionNeeds.find((n) => n.position === 'QB')!;
    expect(qb.games).toBe(0);
    expect(qb.unmeasured).toBe(true);
    expect(qb.weak).toBe(false);
    expect(json.weakPositions).not.toContain('QB');
  });

  // WHY: every roster has a thinnest position whether or not it is bad enough to
  //      act on. Showing only what crossed a threshold meant most weeks showed
  //      nothing at all, and a week that showed one chip gave no way to judge it.
  it('ranks every started position, not only the weak ones', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      positionNeeds: { position: string; rank: number; of: number; slots: number }[];
    };

    // One entry per position the league starts — QB, RB, WR, TE, K.
    expect(json.positionNeeds.map((n) => n.position).sort())
      .toEqual(['K', 'QB', 'RB', 'TE', 'WR']);
    for (const need of json.positionNeeds) {
      expect(need.rank).toBeGreaterThanOrEqual(1);
      expect(need.rank).toBeLessThanOrEqual(need.of);
      expect(need.slots).toBeGreaterThan(0);
    }
  });

  // WHY: a roster carrying nobody at a position used to be left out of that
  //      position's median entirely — the teams with the hole, which is the
  //      thing being measured, were the ones excluded from the measurement. An
  //      unfilled slot is worth zero and now counts as zero.
  it('counts a roster with no player at a position toward that position\'s median', async () => {
    const { leagueId } = freshIds();
    // Three teams carry a TE, one carries none. Mine is the weakest of the
    // three at 8 against two 10s — below par while the empty roster is ignored,
    // at or above it once that roster counts for what it is worth.
    const teRosters = [
      { roster_id: 1, owner_id: 'uid-1', players: ['te-mine'] },
      { roster_id: 2, owner_id: 'uid-2', players: ['te-a'] },
      { roster_id: 3, owner_id: 'uid-3', players: ['te-b'] },
      { roster_id: 4, owner_id: 'uid-4', players: [] },
    ];
    const tePlayers = new Map([
      ['te-mine', { name: 'TE Mine', position: 'TE', team: 'GB',  gsisId: '00-te-mine' }],
      ['te-a',    { name: 'TE A',    position: 'TE', team: 'KC',  gsisId: '00-te-a'    }],
      ['te-b',    { name: 'TE B',    position: 'TE', team: 'BAL', gsisId: '00-te-b'    }],
      ['te-available', { name: 'Tucker Kraft', position: 'TE', team: 'GB', gsisId: '00-gsis-te-1' }],
    ]);
    mockSleeperGet
      .mockResolvedValueOnce(teRosters as never)
      .mockResolvedValueOnce(trendingRaw as never);
    mockGetPlayerMap.mockResolvedValueOnce(tePlayers as never);
    mockFindMany.mockImplementation((async (args: {
      where?: { headshot?: unknown; week?: unknown };
    }) => {
      if (args?.where?.headshot) return [];
      if (args?.where?.week === undefined) return [];
      return [
        { playerId: '00-te-mine', position: 'TE', fantasyPoints: 8,  receptions: 0 },
        { playerId: '00-te-a',    position: 'TE', fantasyPoints: 10, receptions: 0 },
        { playerId: '00-te-b',    position: 'TE', fantasyPoints: 10, receptions: 0 },
      ];
    }) as never);

    const res  = await GET(makeReq(leagueId, 'uid-1'));
    const json = await res.json() as { weakPositions: string[] };

    // Par across all four rosters is 9 (the median of 0, 8, 10, 10); 8 is within
    // 15% of it. Dropping the empty roster would put par at 10 and read this as
    // a weakness that is not one.
    expect(json.weakPositions).not.toContain('TE');
  });

  // WHY: the lineup the weakness was measured over is part of the answer. The UI
  //      says "your top two RBs", which is only true if it knows there are two.
  it('reports the starter slots the weakness test used', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res  = await GET(makeReq(leagueId, userId));
    const json = await res.json() as { starterSlots: Record<string, number> };

    expect(json.starterSlots).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1 });
  });

  // WHY: Each suggestion must carry the fields the UI needs:
  //      playerId, name, position, team, recentAvg, reason.
  it('returns suggestions with the expected player fields', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    const res = await GET(makeReq(leagueId, userId));
    const json = await res.json() as {
      suggestions: { playerId: string; name: string; position: string; reason: string }[]
    };

    if (json.suggestions.length > 0) {
      const s = json.suggestions[0];
      expect(typeof s.playerId).toBe('string');
      expect(typeof s.name).toBe('string');
      expect(typeof s.position).toBe('string');
      expect(typeof s.reason).toBe('string');
    }
  });

  // WHY: Sleeper documents the trending lookback as a range topping out at 168
  //      hours. A larger number is not a wider window, it is an undefined
  //      request — and the call has to carry the trending TTL, not the default
  //      league one, since Sleeper recomputes these about hourly.
  it('asks for trending adds within the documented lookback range', async () => {
    const { leagueId, userId } = freshIds();
    setupHappyPath();

    await GET(makeReq(leagueId, userId));

    const call = mockSleeperGet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/trending/'),
    );
    expect(call).toBeDefined();

    const url = new URL(`https://api.sleeper.app/v1${call![0]}`);
    const lookback = Number(url.searchParams.get('lookback_hours'));
    expect(lookback).toBeGreaterThan(0);
    expect(lookback).toBeLessThanOrEqual(168);
    expect(call![1]).toBe(SLEEPER_TTL.TRENDING);
  });

  // WHY (Rate-limit invariant): A second request with the same leagueId+userId
  //      within the 10-minute TTL must serve the cached result without calling
  //      sleeperGet again. At scale, every saved call matters against the
  //      1000 req/min global cap.
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

  // WHY: Any Sleeper network error must produce a 502 — the error is caught and
  //      converted to a structured response rather than crashing the handler.
  it('returns 502 when a Sleeper fetch throws', async () => {
    const { leagueId, userId } = freshIds();
    mockSleeperGet.mockRejectedValueOnce(new Error('network error'));

    const res = await GET(makeReq(leagueId, userId));
    expect(res.status).toBe(502);
  });
});
