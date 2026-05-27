// tests/app/api/sleeper/matchups/route.test.ts
//
// GET /api/sleeper/matchups?leagueId=&week=
//
// Joins three Sleeper endpoints (matchups, rosters, users) to produce
// ready-to-render matchup pairs. Cached 5 min per league+week key.
//
// Mocks: @/lib/sleeper/client (sleeperGet)
//
// Cache note: the module-level RouteCache persists between tests. We avoid
// collisions by using a unique leagueId per test (different cache keys).

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/sleeper/client', () => ({
  sleeperGet: jest.fn(),
  SLEEPER_BASE: 'https://api.sleeper.app/v1',
}));

import { GET } from '@/app/api/sleeper/matchups/route';
import { sleeperGet } from '@/lib/sleeper/client';

const mockSleeperGet = sleeperGet as jest.MockedFunction<typeof sleeperGet>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Two matchup pairs — roster IDs 1+2 face each other (matchup_id 10),
// roster IDs 3+4 face each other (matchup_id 11).
const matchupsRaw = [
  { roster_id: 1, matchup_id: 10, points: 115.4, starters: [], players: [] },
  { roster_id: 2, matchup_id: 10, points: 98.2,  starters: [], players: [] },
  { roster_id: 3, matchup_id: 11, points: 130.0, starters: [], players: [] },
  { roster_id: 4, matchup_id: 11, points: 110.5, starters: [], players: [] },
];

const rosters = [
  { roster_id: 1, owner_id: 'uid-1', players: [], settings: { wins: 5, losses: 3, fpts: 0, fpts_decimal: 0 } },
  { roster_id: 2, owner_id: 'uid-2', players: [], settings: { wins: 4, losses: 4, fpts: 0, fpts_decimal: 0 } },
  { roster_id: 3, owner_id: 'uid-3', players: [], settings: { wins: 7, losses: 1, fpts: 0, fpts_decimal: 0 } },
  { roster_id: 4, owner_id: 'uid-4', players: [], settings: { wins: 2, losses: 6, fpts: 0, fpts_decimal: 0 } },
];

const users = [
  { user_id: 'uid-1', display_name: 'Alice', metadata: { team_name: 'Alpha Squad' } },
  { user_id: 'uid-2', display_name: 'Bob',   metadata: { team_name: '' } },  // empty → fallback
  { user_id: 'uid-3', display_name: 'Carol', metadata: { team_name: 'Gamma Force' } },
  { user_id: 'uid-4', display_name: 'Dave',  metadata: {} },                 // missing → fallback
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Each test uses a unique leagueId to prevent RouteCache hits from prior tests.
let testLeagueId = 0;
function makeReq(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost/api/sleeper/matchups?${qs}`);
}
function freshLeagueId(): string {
  return `test-league-${++testLeagueId}`;
}

// Queues the standard three sleeperGet responses for the happy path.
function setupHappyPath(): void {
  mockSleeperGet
    .mockResolvedValueOnce(matchupsRaw as never)
    .mockResolvedValueOnce(rosters as never)
    .mockResolvedValueOnce(users as never);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/sleeper/matchups', () => {
  beforeEach(() => {
    mockSleeperGet.mockReset();
  });

  // WHY: leagueId is the primary key for all three Sleeper calls — without it
  //      the route cannot build any URL and must fail fast.
  it('returns 400 when leagueId is missing', async () => {
    const res = await GET(makeReq({ week: '5' }));
    expect(res.status).toBe(400);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });

  // WHY: week must be 1–18 — values outside that range fetch invalid data from
  //      Sleeper. The route validates before making any API calls.
  it('returns 400 when week is 19 (out of range)', async () => {
    const res = await GET(makeReq({ leagueId: freshLeagueId(), week: '19' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when week is 0', async () => {
    const res = await GET(makeReq({ leagueId: freshLeagueId(), week: '0' }));
    expect(res.status).toBe(400);
  });

  // WHY: The happy path must join all three endpoints and return one pair per
  //      matchup_id — four roster entries with two distinct matchup_ids → two pairs.
  // WHY: The happy path must join all three endpoints and return one pair per
  //      matchup_id — four roster entries with two distinct matchup_ids → two pairs.
  //      ok() returns the array directly (no { data: ... } wrapper).
  it('returns matched pairs sorted by matchupId', async () => {
    setupHappyPath();
    const res = await GET(makeReq({ leagueId: freshLeagueId(), week: '5' }));
    const json = await res.json() as { matchupId: number }[];

    expect(res.status).toBe(200);
    expect(json).toHaveLength(2);
    expect(json[0].matchupId).toBe(10);
    expect(json[1].matchupId).toBe(11);
  });

  // WHY: user metadata.team_name takes priority over display_name.
  //      When team_name is empty/missing, display_name is the fallback.
  it('uses team_name when set and display_name as fallback when team_name is empty', async () => {
    setupHappyPath();
    const res = await GET(makeReq({ leagueId: freshLeagueId(), week: '5' }));
    const json = await res.json() as { home: { teamName: string }; away: { teamName: string } }[];
    const pair = json[0]; // matchupId 10: uid-1 vs uid-2

    expect(pair.home.teamName).toBe('Alpha Squad'); // team_name set
    expect(pair.away.teamName).toBe('Bob');          // team_name empty → display_name
  });

  // WHY: Points, wins, and losses from the raw Sleeper data must be carried
  //      through to each team object in the response.
  it('carries through points, wins, and losses', async () => {
    setupHappyPath();
    const res = await GET(makeReq({ leagueId: freshLeagueId(), week: '5' }));
    const json = await res.json() as { home: { points: number; wins: number; losses: number } }[];
    const home = json[0].home; // roster_id 1

    expect(home.points).toBe(115.4);
    expect(home.wins).toBe(5);
    expect(home.losses).toBe(3);
  });

  // WHY: If a Sleeper fetch throws (network error or non-ok response),
  //      the route must return 502 rather than let an unhandled exception surface.
  it('returns 502 when a Sleeper fetch throws', async () => {
    mockSleeperGet.mockRejectedValueOnce(new Error('network error'));

    const res = await GET(makeReq({ leagueId: freshLeagueId(), week: '5' }));
    expect(res.status).toBe(502);
  });
});
