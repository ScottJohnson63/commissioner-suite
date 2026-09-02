// tests/unit/lib/sleeper/liveNames.test.ts
//
// Covers src/lib/sleeper/liveNames.ts — reading current names from Sleeper for
// rows the database only holds a sync-time copy of.
//
// The behaviour that matters most here is the failure path. These helpers sit in
// front of the schedule page, the CSV export and the league list, so a Sleeper
// outage must degrade to the stored name rather than blanking a team or throwing
// a 500. Every test below that ends in "falls back" is guarding that.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/sleeper/client', () => ({
  ...jest.requireActual<typeof import('@/lib/sleeper/client')>('@/lib/sleeper/client'),
  sleeperGet: jest.fn(),
}));

import { teamNameResolver, fetchLeagueNames } from '@/lib/sleeper/liveNames';
import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';

const mockSleeperGet = sleeperGet as jest.MockedFunction<typeof sleeperGet>;

const users = [
  { user_id: 'u1', display_name: 'Scott', metadata: { team_name: 'Discount Double Perc' } },
  { user_id: 'u2', display_name: 'Alex' },
];
const rosters = [
  { roster_id: 1, owner_id: 'u1', players: null, settings: { wins: 0, losses: 0, fpts: 0, fpts_decimal: 0 } },
  { roster_id: 2, owner_id: 'u2', players: null, settings: { wins: 0, losses: 0, fpts: 0, fpts_decimal: 0 } },
];

/** fetchRosterInfo calls users then rosters, in that order. */
function mockRosterInfoOnce() {
  mockSleeperGet
    .mockResolvedValueOnce(users as never)
    .mockResolvedValueOnce(rosters as never);
}

describe('teamNameResolver()', () => {
  beforeEach(() => { mockSleeperGet.mockReset(); });

  // WHY: the whole point of the redesign. The stored name is what sync captured;
  //      the live name is what the manager actually has set right now.
  it('returns the live Sleeper name over the stored one', async () => {
    mockRosterInfoOnce();
    const nameFor = await teamNameResolver('999');
    expect(nameFor('1', 'You Shedeur about that?')).toBe('Discount Double Perc');
  });

  it('keys the lookup on the stored roster id, which is a string in the DB', async () => {
    mockRosterInfoOnce();
    const nameFor = await teamNameResolver('999');
    // Team.sleeperRosterId is a String column; Sleeper's roster_id is a number.
    expect(nameFor('2', 'stale')).toBe('Alex');
  });

  // WHY: a roster that has since left the league still has Matchup rows pointing
  //      at it. Those must keep rendering, not go blank.
  it('falls back to the stored name for a roster Sleeper no longer lists', async () => {
    mockRosterInfoOnce();
    const nameFor = await teamNameResolver('999');
    expect(nameFor('99', 'Departed Team')).toBe('Departed Team');
  });

  // WHY: this helper runs on the schedule page and the CSV export. If Sleeper is
  //      down, those must still render with stored names.
  it('falls back to every stored name when Sleeper throws', async () => {
    mockSleeperGet.mockRejectedValue(new Error('Sleeper 503'));
    const nameFor = await teamNameResolver('999');
    expect(nameFor('1', 'Stored One')).toBe('Stored One');
    expect(nameFor('2', 'Stored Two')).toBe('Stored Two');
  });

  it('passes the freshness window through to Sleeper', async () => {
    mockRosterInfoOnce();
    await teamNameResolver('999');
    expect(mockSleeperGet).toHaveBeenNthCalledWith(1, '/league/999/users', SLEEPER_TTL.LEAGUE);
  });
});

describe('fetchLeagueNames()', () => {
  beforeEach(() => { mockSleeperGet.mockReset(); });

  it('returns current names keyed by Sleeper league id', async () => {
    mockSleeperGet
      .mockResolvedValueOnce({ name: 'Discount Double Perc' } as never)
      .mockResolvedValueOnce({ name: 'Baby got Dak' } as never);

    const names = await fetchLeagueNames(['111', '222']);

    expect(names.get('111')).toBe('Discount Double Perc');
    expect(names.get('222')).toBe('Baby got Dak');
  });

  // WHY: this runs on GET /api/leagues, which every page load hits. One league
  //      Sleeper cannot answer for must not empty the whole allowlist.
  it('drops only the leagues that fail, keeping the rest', async () => {
    mockSleeperGet
      .mockResolvedValueOnce({ name: 'Still Here' } as never)
      .mockRejectedValueOnce(new Error('Sleeper 404'));

    const names = await fetchLeagueNames(['111', '222']);

    expect(names.get('111')).toBe('Still Here');
    expect(names.has('222')).toBe(false);
    expect(names.size).toBe(1);
  });

  it('returns an empty map when every league fails', async () => {
    mockSleeperGet.mockRejectedValue(new Error('Sleeper down'));
    expect((await fetchLeagueNames(['111', '222'])).size).toBe(0);
  });

  // WHY: an omitted entry means "no live answer", which callers read as "keep the
  //      stored name". A blank name from Sleeper must not overwrite a real one.
  it('omits a league whose Sleeper name is blank', async () => {
    mockSleeperGet.mockResolvedValueOnce({ name: '' } as never);
    expect((await fetchLeagueNames(['111'])).has('111')).toBe(false);
  });

  it('makes no calls for an empty list', async () => {
    expect((await fetchLeagueNames([])).size).toBe(0);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });
});
