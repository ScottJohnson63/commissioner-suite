// tests/unit/lib/sleeper/teams.test.ts
//
// Covers src/lib/sleeper/teams.ts — the shared "what is this team called?" rule.
//
// This logic was duplicated across seven files before it was centralised, and
// the copies had drifted apart. These tests pin the behaviour every one of those
// call sites now depends on, so a future edit here cannot quietly change what
// six routes render.

import { describe, it, expect, jest } from '@jest/globals';

jest.mock('@/lib/sleeper/client', () => ({
  ...jest.requireActual<typeof import('@/lib/sleeper/client')>('@/lib/sleeper/client'),
  sleeperGet: jest.fn(),
}));

import {
  resolveTeamName,
  buildUserMap,
  buildRosterInfo,
  fetchRosterInfo,
} from '@/lib/sleeper/teams';
import { sleeperGet } from '@/lib/sleeper/client';
import type { SleeperRoster, SleeperUser } from '@/lib/sleeper/types';

const mockSleeperGet = sleeperGet as jest.MockedFunction<typeof sleeperGet>;

/** Builds a minimal SleeperUser without repeating the optional fields. */
function user(partial: Partial<SleeperUser> & { user_id: string }): SleeperUser {
  return { display_name: '', ...partial };
}

/** Builds a minimal SleeperRoster — only the fields this module reads. */
function roster(rosterId: number, ownerId: string | null): SleeperRoster {
  return {
    roster_id: rosterId,
    owner_id:  ownerId,
    players:   null,
    settings:  { wins: 0, losses: 0, fpts: 0, fpts_decimal: 0 },
  };
}

describe('resolveTeamName()', () => {
  it('prefers the custom team name', () => {
    const u = user({ user_id: 'u1', display_name: 'Scott', metadata: { team_name: 'Glizzy Goblins' } });
    expect(resolveTeamName(u, 1)).toBe('Glizzy Goblins');
  });

  it('falls back to the display name when no team name is set', () => {
    expect(resolveTeamName(user({ user_id: 'u1', display_name: 'Scott' }), 1)).toBe('Scott');
  });

  // WHY: this is the bug the seven copies disagreed on. Sleeper lets a manager
  //      save an empty team name; `??` keeps it, `||` falls through. Six call
  //      sites fell through, agentContext did not, so the agent rendered a blank
  //      label where every other screen rendered the owner's name.
  it('treats a blank team name as absent, not as a name', () => {
    const u = user({ user_id: 'u1', display_name: 'Scott', metadata: { team_name: '' } });
    expect(resolveTeamName(u, 1)).toBe('Scott');
  });

  it('treats a whitespace-only team name as absent', () => {
    const u = user({ user_id: 'u1', display_name: 'Scott', metadata: { team_name: '   ' } });
    expect(resolveTeamName(u, 1)).toBe('Scott');
  });

  it('trims a padded team name', () => {
    const u = user({ user_id: 'u1', display_name: 'Scott', metadata: { team_name: '  Baby got Dak  ' } });
    expect(resolveTeamName(u, 1)).toBe('Baby got Dak');
  });

  it('falls back to "Team N" when the roster has no owner', () => {
    expect(resolveTeamName(undefined, 7)).toBe('Team 7');
  });

  it('falls back to "Team N" when both names are blank', () => {
    const u = user({ user_id: 'u1', display_name: '   ', metadata: { team_name: '' } });
    expect(resolveTeamName(u, 3)).toBe('Team 3');
  });

  // WHY: matchups renders "Roster N" and matchup-report renders "Unknown" for an
  //      empty slot. Those labels are deliberate, so the override must win over
  //      the shared default without changing the rule above it.
  it('uses a caller-supplied fallback ahead of "Team N"', () => {
    expect(resolveTeamName(undefined, 7, 'Unknown')).toBe('Unknown');
    expect(resolveTeamName(undefined, 7, 'Roster 7')).toBe('Roster 7');
  });

  it('still prefers a real name over the caller-supplied fallback', () => {
    const u = user({ user_id: 'u1', display_name: 'Scott' });
    expect(resolveTeamName(u, 7, 'Unknown')).toBe('Scott');
  });
});

describe('buildUserMap()', () => {
  it('indexes users by their Sleeper user id', () => {
    const map = buildUserMap([user({ user_id: 'a' }), user({ user_id: 'b' })]);
    expect(map.get('a')?.user_id).toBe('a');
    expect(map.size).toBe(2);
  });

  // WHY: Sleeper returns null for a league with no members yet, and several call
  //      sites pass the raw response straight through.
  it('returns an empty map for null or undefined', () => {
    expect(buildUserMap(null).size).toBe(0);
    expect(buildUserMap(undefined).size).toBe(0);
  });
});

describe('buildRosterInfo()', () => {
  const users = [
    user({ user_id: 'u1', display_name: 'Scott', metadata: { team_name: 'Glizzy Goblins' } }),
    user({ user_id: 'u2', display_name: 'Alex' }),
  ];
  const rosters = [roster(1, 'u1'), roster(2, 'u2'), roster(3, null)];

  it('joins users onto rosters, keyed by roster id', () => {
    const info = buildRosterInfo(users, rosters);
    expect(info.get(1)?.name).toBe('Glizzy Goblins');
    expect(info.get(2)?.name).toBe('Alex');
  });

  it('names an unowned roster with the "Team N" fallback', () => {
    const info = buildRosterInfo(users, rosters);
    expect(info.get(3)?.name).toBe('Team 3');
    expect(info.get(3)?.ownerName).toBeNull();
    expect(info.get(3)?.ownerId).toBeNull();
  });

  // WHY: ownerName is the manager, name is the team. A route that shows both
  //      must not get the team name in the owner slot.
  it('keeps ownerName as the display name even when a team name exists', () => {
    const info = buildRosterInfo(users, rosters);
    expect(info.get(1)?.name).toBe('Glizzy Goblins');
    expect(info.get(1)?.ownerName).toBe('Scott');
  });

  it('tolerates null payloads from Sleeper', () => {
    expect(buildRosterInfo(null, null).size).toBe(0);
  });
});

describe('fetchRosterInfo()', () => {
  it('fetches users and rosters and returns the joined result', async () => {
    mockSleeperGet
      .mockResolvedValueOnce([user({ user_id: 'u1', display_name: 'Scott' })] as never)
      .mockResolvedValueOnce([roster(1, 'u1')] as never);

    const info = await fetchRosterInfo('999');

    expect(info.get(1)?.name).toBe('Scott');
    expect(mockSleeperGet).toHaveBeenCalledTimes(2);
  });

  // WHY: the caller controls freshness — league-teams passes SLEEPER_TTL.FRESH
  //      when ?refresh=1 is set, and that has to reach both calls or the refresh
  //      silently serves one cached half.
  it('passes the revalidate value through to both calls', async () => {
    mockSleeperGet.mockReset();
    mockSleeperGet
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    await fetchRosterInfo('999', 0);

    expect(mockSleeperGet).toHaveBeenNthCalledWith(1, '/league/999/users', 0);
    expect(mockSleeperGet).toHaveBeenNthCalledWith(2, '/league/999/rosters', 0);
  });
});
