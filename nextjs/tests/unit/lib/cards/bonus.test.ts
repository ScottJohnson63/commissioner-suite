// tests/unit/lib/cards/bonus.test.ts
//
// Covers the Sleeper bonus rules in src/lib/cards/bonus.ts.
//
// Sleeper reports each side of a matchup as its own row with a shared
// `matchup_id` and no winner field, so "did I win" has to be worked out — and
// the edges are where it goes wrong. A tie is not a win, a bye is not a win, and
// a roster with no entry scored nothing rather than crashing. Each of those is
// a pack wrongly granted or wrongly withheld.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockHeldBonuses = jest.fn<() => Promise<{ kind: string }[]>>();
const mockCreateBonus = jest.fn<(a: unknown) => Promise<unknown>>();
const mockUpdateGrant = jest.fn<(a: unknown) => Promise<unknown>>();
const mockEnsureGrant = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockSleeperGet = jest.fn<(path: string) => Promise<unknown>>();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    packBonus: {
      findMany: () => mockHeldBonuses(),
      create:   (a: unknown) => mockCreateBonus(a),
    },
    packGrant: { updateMany: (a: unknown) => mockUpdateGrant(a) },
  },
}));
jest.mock('@/lib/cards/allowance', () => ({
  ensureGrant: (...a: unknown[]) => mockEnsureGrant(...a),
}));
jest.mock('@/lib/sleeper/client', () => ({
  sleeperGet: (path: string) => mockSleeperGet(path),
  SLEEPER_TTL: { LEAGUE: 0 },
}));

import {
  didRosterWin, rosterPoints, claimBonuses, HIGH_SCORE_THRESHOLD, BONUS_KINDS,
} from '@/lib/cards/bonus';
import type { SleeperMatchupRaw } from '@/lib/sleeper/types';

const entry = (
  roster_id: number, matchup_id: number | null, points: number,
): SleeperMatchupRaw => ({ roster_id, matchup_id, points });

/** A week with a decisive game, a tie, and a bye. */
const WEEK: SleeperMatchupRaw[] = [
  entry(1, 1, 112.4),
  entry(2, 1, 98.2),
  entry(3, 2, 88.0),
  entry(4, 2, 88.0),
  entry(5, null, 101.0),
];

describe('didRosterWin()', () => {
  it('is true for the higher score in a pairing', () => {
    expect(didRosterWin(WEEK, 1)).toBe(true);
  });

  it('is false for the lower score', () => {
    expect(didRosterWin(WEEK, 2)).toBe(false);
  });

  // WHY: a tie is not a win. Using >= here would hand both managers a pack.
  it('is false for a tie', () => {
    expect(didRosterWin(WEEK, 3)).toBe(false);
    expect(didRosterWin(WEEK, 4)).toBe(false);
  });

  // WHY: Sleeper marks a bye with a null matchup_id. Nobody was beaten, so
  //      there is nothing to reward — and a high-scoring bye would otherwise
  //      look like a win against an empty opponent list.
  it('is false for a bye, however many points were scored', () => {
    expect(didRosterWin(WEEK, 5)).toBe(false);
  });

  it('is false for a roster with no entry that week', () => {
    expect(didRosterWin(WEEK, 99)).toBe(false);
  });

  it('is false for an empty week', () => {
    expect(didRosterWin([], 1)).toBe(false);
  });

  // WHY: a pairing with only one side present is a bye wearing a matchup_id.
  it('is false when the pairing has no opponent', () => {
    expect(didRosterWin([entry(1, 7, 150)], 1)).toBe(false);
  });

  // WHY: some Sleeper leagues run multi-team matchups. Beating one opponent but
  //      not another is not a win.
  it('requires beating every opponent in the pairing', () => {
    const threeWay = [entry(1, 1, 100), entry(2, 1, 90), entry(3, 1, 110)];
    expect(didRosterWin(threeWay, 1)).toBe(false);
    expect(didRosterWin(threeWay, 3)).toBe(true);
  });
});

describe('rosterPoints()', () => {
  it('reads the roster’s score', () => {
    expect(rosterPoints(WEEK, 1)).toBe(112.4);
  });

  // WHY: feeds the high-score comparison, so a missing entry must be 0 rather
  //      than undefined — `undefined > 100` is false but `undefined` in the
  //      stored `points` column would be a lie about what happened.
  it('is zero for a roster with no entry', () => {
    expect(rosterPoints(WEEK, 99)).toBe(0);
    expect(rosterPoints([], 1)).toBe(0);
  });
});

describe('the bonus rules', () => {
  it('has exactly two ways to earn a pack', () => {
    expect(BONUS_KINDS).toEqual(['WIN', 'HIGH_SCORE']);
  });

  // WHY: "over 100" is strict. Exactly 100 does not earn the pack.
  it('sets the high-score line at 100, exclusive', () => {
    expect(HIGH_SCORE_THRESHOLD).toBe(100);
    expect(rosterPoints(WEEK, 5) > HIGH_SCORE_THRESHOLD).toBe(true);   // 101
    expect(100 > HIGH_SCORE_THRESHOLD).toBe(false);
  });
});

describe('claimBonuses()', () => {
  // A won week 2: the member's roster beat its opponent and cleared 100.
  const WON_WEEK_2: SleeperMatchupRaw[] = [entry(7, 1, 150.2), entry(8, 1, 90.1)];

  beforeEach(() => {
    for (const m of [mockHeldBonuses, mockCreateBonus, mockUpdateGrant,
                     mockEnsureGrant, mockSleeperGet]) {
      m.mockReset();
    }
    mockHeldBonuses.mockResolvedValue([]);
    mockCreateBonus.mockResolvedValue({});
    mockUpdateGrant.mockResolvedValue({ count: 1 });
    mockEnsureGrant.mockResolvedValue({});
    mockSleeperGet.mockImplementation(async (path: string) => {
      if (path === '/user/sleeper-1/leagues/nfl/2026') return [{ league_id: 'L1' }];
      if (path === '/league/L1/rosters') return [{ roster_id: 7, owner_id: 'sleeper-1' }];
      if (path === '/league/L1/matchups/2') return WON_WEEK_2;
      return [];
    });
  });

  // Each case uses its own member id: the two-minute in-process guard is keyed
  // on (user, season, scored week) and outlives a single test.

  // WHY: issue #52. Sleeper reports live points, so reading the week in play
  //      paid a member for leading at half time — and nothing takes a bonus
  //      back. The results come from the week that finished; the pack lands on
  //      the week being played, because a grant the member can no longer reach
  //      is not a prize.
  it('scores the completed week and pays the pack onto the current one', async () => {
    const result = await claimBonuses('u-1', 'sleeper-1', 2026, 2, 3);

    expect(mockSleeperGet).toHaveBeenCalledWith('/league/L1/matchups/2');
    expect(mockSleeperGet).not.toHaveBeenCalledWith('/league/L1/matchups/3');
    expect([...result.kinds].sort()).toEqual(['HIGH_SCORE', 'WIN']);
    expect(result.week).toBe(2);

    // The ledger row is keyed on the week that earned it...
    expect(mockCreateBonus).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ week: 2 }) }),
    );
    // ...and the packs land on the current week's grant.
    expect(mockUpdateGrant).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ week: 3 }) }),
    );
  });

  // WHY: grant rows are created lazily by whoever reads one first, and reading
  //      a finished week means the award now usually happens on the first visit
  //      of the new week — before anything has created that week's row. An
  //      increment against a row that does not exist updates nothing, and the
  //      PackBonus row would stay behind to block ever earning it again.
  it('creates the current week’s grant before crediting it', async () => {
    await claimBonuses('u-2', 'sleeper-1', 2026, 2, 3);

    expect(mockEnsureGrant).toHaveBeenCalledWith('u-2', 2026, 3);
    expect(mockEnsureGrant.mock.invocationCallOrder[0])
      .toBeLessThan(mockUpdateGrant.mock.invocationCallOrder[0]);
  });

  // WHY: in NFL week 1 the completed week floors to 1 as well, and scoring
  //      week 1 while week 1 is being played is exactly the bug. Nothing is
  //      asked of Sleeper and nothing is read from the ledger.
  it('awards nothing while no week has finished', async () => {
    const result = await claimBonuses('u-3', 'sleeper-1', 2026, 1, 1);

    expect(result).toEqual({ awarded: [], kinds: [], week: null });
    expect(mockSleeperGet).not.toHaveBeenCalled();
    expect(mockHeldBonuses).not.toHaveBeenCalled();
  });

  // WHY: also what stops a second payout for members already paid under the old
  //      live-week reading — their row sits under the week it was scored from,
  //      which is the week now being checked.
  it('asks Sleeper nothing once both rules are held for that week', async () => {
    mockHeldBonuses.mockResolvedValue([{ kind: 'WIN' }, { kind: 'HIGH_SCORE' }]);

    const result = await claimBonuses('u-4', 'sleeper-1', 2026, 2, 3);

    expect(mockSleeperGet).not.toHaveBeenCalled();
    expect(mockCreateBonus).not.toHaveBeenCalled();
    expect([...result.kinds].sort()).toEqual(['HIGH_SCORE', 'WIN']);
    expect(result.week).toBe(2);
  });

  // WHY: the card game does not require a Sleeper link, and a member without
  //      one must not cost a network call on every page load.
  it('earns nothing without a linked Sleeper account', async () => {
    const result = await claimBonuses('u-5', null, 2026, 2, 3);

    expect(result.awarded).toEqual([]);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });
});
