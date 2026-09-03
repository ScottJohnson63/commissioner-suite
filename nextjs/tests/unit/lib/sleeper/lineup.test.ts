// tests/unit/lib/sleeper/lineup.test.ts
//
// getStarterSlots — how many players a league actually starts at each position.
//
// This backs the waiver panel's weak-spot test, which used to compare each
// roster's single best player at a position however many the league starts
// there. The cases below pin the two things that judgement depends on: which
// slot labels count, and what happens when Sleeper cannot be read.
//
// Mocks:
//   @/lib/sleeper/client — sleeperGet

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/sleeper/client', () => ({
  ...jest.requireActual<typeof import('@/lib/sleeper/client')>('@/lib/sleeper/client'),
  sleeperGet: jest.fn(),
}));

import { getStarterSlots, clearStarterSlotsCache, DEFAULT_STARTER_SLOTS } from '@/lib/sleeper/lineup';
import { sleeperGet } from '@/lib/sleeper/client';

const mockSleeperGet = sleeperGet as jest.MockedFunction<typeof sleeperGet>;

let seq = 0;
const freshLeague = () => `league-lu-${++seq}`;

describe('getStarterSlots', () => {
  beforeEach(() => {
    mockSleeperGet.mockReset();
    clearStarterSlotsCache();
  });

  // WHY: the lineup is the whole point — a league starting two RBs and three WRs
  //      must not be measured one player deep at either.
  it('counts each named position slot', async () => {
    mockSleeperGet.mockResolvedValue({
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'],
    } as never);

    await expect(getStarterSlots(freshLeague())).resolves.toEqual({
      QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1,
    });
  });

  // WHY: bench, IR and taxi entries sit in the same array and are not lineup
  //      slots. Counting them would claim a league starts nine running backs.
  it('ignores bench, IR and taxi entries', async () => {
    mockSleeperGet.mockResolvedValue({
      roster_positions: ['QB', 'RB', 'BN', 'BN', 'BN', 'IR', 'TAXI'],
    } as never);

    await expect(getStarterSlots(freshLeague())).resolves.toEqual({ QB: 1, RB: 1 });
  });

  // WHY: a flex slot is not owed to any one position. Adding it to every
  //      eligible one would say this league starts three RBs, three WRs and two
  //      TEs from six slots — the depth question it raises is already answered
  //      by the explicit slots either side of it.
  it('does not attribute a FLEX slot to any position', async () => {
    mockSleeperGet.mockResolvedValue({
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'REC_FLEX'],
    } as never);

    await expect(getStarterSlots(freshLeague())).resolves.toEqual({
      QB: 1, RB: 2, WR: 2, TE: 1,
    });
  });

  // WHY: a league payload with no lineup at all must not collapse every position
  //      to a one-player comparison, which is the shape of the bug this fixes.
  it('falls back to the standard lineup when the payload names no slots', async () => {
    mockSleeperGet.mockResolvedValue({ roster_positions: [] } as never);

    await expect(getStarterSlots(freshLeague())).resolves.toEqual(DEFAULT_STARTER_SLOTS);
  });

  // WHY: same reasoning as getScoringSettings — a Sleeper outage degrades the
  //      panel rather than failing it.
  it('falls back to the standard lineup when Sleeper is unreachable', async () => {
    mockSleeperGet.mockRejectedValue(new Error('network error'));

    await expect(getStarterSlots(freshLeague())).resolves.toEqual(DEFAULT_STARTER_SLOTS);
  });

  // WHY: a transient failure must not pin the default for the hour the cache
  //      holds. The next request should ask again.
  it('does not cache the fallback, so a recovered Sleeper is picked up', async () => {
    const leagueId = freshLeague();
    mockSleeperGet.mockRejectedValueOnce(new Error('network error'));
    await getStarterSlots(leagueId);

    mockSleeperGet.mockResolvedValue({ roster_positions: ['QB', 'RB', 'RB'] } as never);
    await expect(getStarterSlots(leagueId)).resolves.toEqual({ QB: 1, RB: 2 });
  });

  // WHY (rate limit): lineups change at most once a season. A second read of the
  //      same league inside the TTL must not reach Sleeper again.
  it('serves a repeat read from cache', async () => {
    const leagueId = freshLeague();
    mockSleeperGet.mockResolvedValue({ roster_positions: ['QB', 'RB'] } as never);

    await getStarterSlots(leagueId);
    const callsAfterFirst = mockSleeperGet.mock.calls.length;
    await getStarterSlots(leagueId);

    expect(mockSleeperGet.mock.calls.length).toBe(callsAfterFirst);
  });
});
