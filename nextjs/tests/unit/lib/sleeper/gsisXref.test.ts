// tests/unit/lib/sleeper/gsisXref.test.ts
//
// Covers src/lib/sleeper/gsisXref.ts — translating Sleeper player IDs into the
// nflverse GSIS IDs that NflWeeklyStat is keyed on.
//
// The failure this guards against is silent, not loud: querying the stat table
// with Sleeper IDs returns zero rows, and zero rows is indistinguishable from
// "this player scored nothing". Live waiver averages, trade fairness and matchup
// projections were all being computed from that empty result.
//
// Sleeper's own gsis_id field covers well under a quarter of rostered players, so
// the name fallback is not a nicety — it is most of the coverage.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/prisma', () => ({
  prisma: { nflWeeklyStat: { groupBy: jest.fn() } },
}));

import {
  buildGsisXref, normalizePlayerName, clearGsisXrefCache,
} from '@/lib/sleeper/gsisXref';
import type { SleeperPlayerInfo } from '@/lib/sleeper/playerCache';
import { prisma } from '@/lib/prisma';

const mockGroupBy = prisma.nflWeeklyStat.groupBy as jest.MockedFunction<
  typeof prisma.nflWeeklyStat.groupBy
>;

function player(
  name: string, position: string, gsisId: string | null = null,
): SleeperPlayerInfo {
  return { name, position, team: null, gsisId };
}

/** The season's distinct (playerId, displayName, position) rows from the stat table. */
function statTableHolds(
  rows: { playerId: string; playerDisplayName: string; position: string }[],
): void {
  mockGroupBy.mockResolvedValue(rows as never);
}

describe('normalizePlayerName()', () => {
  // WHY: the two feeds disagree about suffixes far more often than about names.
  //      Sleeper says "Brian Thomas", nflverse says "Brian Thomas Jr.".
  it('drops generational suffixes so the two feeds agree', () => {
    expect(normalizePlayerName('Brian Thomas Jr.'))
      .toBe(normalizePlayerName('Brian Thomas'));
    expect(normalizePlayerName('Kenneth Walker III'))
      .toBe(normalizePlayerName('Kenneth Walker'));
  });

  it('ignores case, punctuation, accents and spacing', () => {
    expect(normalizePlayerName("Ja'Marr Chase")).toBe('jamarrchase');
    expect(normalizePlayerName('Amon-Ra St. Brown')).toBe('amonrastbrown');
    expect(normalizePlayerName('Christian González')).toBe('christiangonzalez');
  });

  it('returns an empty key for a missing name', () => {
    expect(normalizePlayerName(null)).toBe('');
    expect(normalizePlayerName(undefined)).toBe('');
  });
});

describe('buildGsisXref()', () => {
  beforeEach(() => {
    mockGroupBy.mockReset();
    clearGsisXrefCache();
  });

  // WHY: when Sleeper supplies the ID it is authoritative, and it saves the
  //      route a query.
  it("prefers Sleeper's own gsis_id and skips the name index entirely", async () => {
    const map = new Map([['4046', player('Patrick Mahomes', 'QB', '00-0033873')]]);
    const xref = await buildGsisXref(['4046'], map, 2025);

    expect(xref.toGsis.get('4046')).toBe('00-0033873');
    expect(xref.toSleeper.get('00-0033873')).toBe('4046');
    expect(xref.gsisIds).toEqual(['00-0033873']);
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  // WHY: this is the common case, not the edge case — Jayden Daniels, D'Andre
  //      Swift and George Pickens all reach the route with gsis_id null.
  it('falls back to a name and position match when gsis_id is missing', async () => {
    statTableHolds([
      { playerId: '00-0039910', playerDisplayName: 'Jayden Daniels', position: 'QB' },
    ]);
    const map = new Map([['11566', player('Jayden Daniels', 'QB')]]);
    const xref = await buildGsisXref(['11566'], map, 2025);

    expect(xref.toGsis.get('11566')).toBe('00-0039910');
    expect(xref.toSleeper.get('00-0039910')).toBe('11566');
  });

  // WHY: the feeds sometimes list the same player at different positions — a
  //      two-way player, or someone Sleeper has already moved to a new role.
  //      A unique name is enough to resolve that safely.
  it('matches on name alone when the position disagrees but the name is unique', async () => {
    statTableHolds([
      { playerId: '00-0039912', playerDisplayName: 'Travis Hunter', position: 'CB' },
    ]);
    const map = new Map([['12500', player('Travis Hunter', 'WR')]]);
    const xref = await buildGsisXref(['12500'], map, 2025);

    expect(xref.toGsis.get('12500')).toBe('00-0039912');
  });

  // WHY: guessing between two players who share a name would attribute one
  //      man's season to another. Leaving him unresolved shows zero, which is
  //      wrong in a way the reader can see rather than one they cannot.
  it('refuses a name-only match when two players share the name', async () => {
    statTableHolds([
      { playerId: '00-0000001', playerDisplayName: 'Mike Williams', position: 'WR' },
      { playerId: '00-0000002', playerDisplayName: 'Mike Williams', position: 'TE' },
    ]);
    const map = new Map([['9999', player('Mike Williams', 'RB')]]);
    const xref = await buildGsisXref(['9999'], map, 2025);

    expect(xref.toGsis.has('9999')).toBe(false);
    expect(xref.gsisIds).toEqual([]);
  });

  // WHY: the position-qualified key still resolves them, so a shared name only
  //      costs coverage for the player whose position also disagrees.
  it('still resolves shared names through the position-qualified key', async () => {
    statTableHolds([
      { playerId: '00-0000001', playerDisplayName: 'Mike Williams', position: 'WR' },
      { playerId: '00-0000002', playerDisplayName: 'Mike Williams', position: 'TE' },
    ]);
    const map = new Map([['9999', player('Mike Williams', 'TE')]]);
    const xref = await buildGsisXref(['9999'], map, 2025);

    expect(xref.toGsis.get('9999')).toBe('00-0000002');
  });

  // WHY: toSleeper is used to map query rows back, so two Sleeper IDs pointing at
  //      one GSIS ID would silently drop one player's stats onto the other.
  it('never maps one GSIS ID onto two Sleeper players, gsis_id path', async () => {
    statTableHolds([]);
    const map = new Map([
      ['4046',  player('Patrick Mahomes', 'QB', '00-0033873')],
      ['4046b', player('Patrick Mahomes', 'QB', '00-0033873')],
    ]);
    const xref = await buildGsisXref(['4046', '4046b'], map, 2025);

    expect(xref.gsisIds).toEqual(['00-0033873']);
    expect(xref.toSleeper.get('00-0033873')).toBe('4046');
    expect(xref.toGsis.has('4046b')).toBe(false);
  });

  it('never maps one GSIS ID onto two Sleeper players, name path', async () => {
    statTableHolds([
      { playerId: '00-0039910', playerDisplayName: 'Jayden Daniels', position: 'QB' },
    ]);
    const map = new Map([
      ['11566', player('Jayden Daniels',  'QB')],
      ['11567', player('Jayden Daniels.', 'QB')], // same normalised key
    ]);
    const xref = await buildGsisXref(['11566', '11567'], map, 2025);

    expect(xref.gsisIds).toEqual(['00-0039910']);
    expect(xref.toSleeper.get('00-0039910')).toBe('11566');
  });

  // WHY: Sleeper ships 22% of its gsis_id values with a leading space. Untrimmed
  //      they are truthy but join to nothing, so the player resolves to a query
  //      that finds no rows and silently scores zero — strictly worse than having
  //      no ID at all, which would have sent him to the name lookup.
  it('trims whitespace-padded gsis_id values', async () => {
    statTableHolds([]);
    const map = new Map([['5850', player('Josh Jacobs', 'RB', ' 00-0035700')]]);
    const xref = await buildGsisXref(['5850'], map, 2025);

    expect(xref.toGsis.get('5850')).toBe('00-0035700');
    expect(xref.gsisIds).toEqual(['00-0035700']);
  });

  // WHY: a whitespace-only ID is no ID. Treating it as present would strand the
  //      player instead of letting the name index resolve him.
  it('sends a blank gsis_id to the name lookup instead of trusting it', async () => {
    statTableHolds([
      { playerId: '00-0035700', playerDisplayName: 'Josh Jacobs', position: 'RB' },
    ]);
    const map = new Map([['5850', player('Josh Jacobs', 'RB', '   ')]]);
    const xref = await buildGsisXref(['5850'], map, 2025);

    expect(xref.toGsis.get('5850')).toBe('00-0035700');
  });

  // WHY: rookies and players who missed the season have no rows to match. They
  //      must drop out quietly rather than throwing.
  it('omits players it cannot resolve', async () => {
    statTableHolds([]);
    const map = new Map([['12507', player('Omarion Hampton', 'RB')]]);
    const xref = await buildGsisXref(['12507'], map, 2025);

    expect(xref.gsisIds).toEqual([]);
  });

  // WHY: a defense is not a person and has no GSIS id. Sleeper identifies one by
  //      team abbreviation and the defense sync stores its rows under the same,
  //      so the mapping is an identity — and must not be sent to the name index,
  //      where "Ravens" would match nothing.
  it('maps a team defense to itself without consulting the name index', async () => {
    const map = new Map([['BAL', player('Ravens', 'DEF')]]);
    const xref = await buildGsisXref(['BAL'], map, 2025);

    expect(xref.toGsis.get('BAL')).toBe('BAL');
    expect(xref.toSleeper.get('BAL')).toBe('BAL');
    expect(xref.gsisIds).toEqual(['BAL']);
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  // WHY: defenses and players arrive in one roster array, so the two paths have
  //      to coexist in a single call.
  it('resolves defenses alongside players in one pass', async () => {
    statTableHolds([
      { playerId: '00-0039910', playerDisplayName: 'Jayden Daniels', position: 'QB' },
    ]);
    const map = new Map([
      ['BAL',   player('Ravens',         'DEF')],
      ['11566', player('Jayden Daniels', 'QB')],
      ['4046',  player('Patrick Mahomes', 'QB', '00-0033873')],
    ]);
    const xref = await buildGsisXref(['BAL', '11566', '4046'], map, 2025);

    expect(xref.gsisIds.sort()).toEqual(['00-0033873', '00-0039910', 'BAL']);
  });

  it('ignores IDs missing from the player map', async () => {
    statTableHolds([]);
    const xref = await buildGsisXref(['ghost'], new Map(), 2025);
    expect(xref.gsisIds).toEqual([]);
  });

  // WHY: three panels build an xref per dashboard render; the index is the whole
  //      season's player list and does not change between them.
  it('loads the name index once per season', async () => {
    statTableHolds([
      { playerId: '00-0039910', playerDisplayName: 'Jayden Daniels', position: 'QB' },
    ]);
    const map = new Map([['11566', player('Jayden Daniels', 'QB')]]);
    await buildGsisXref(['11566'], map, 2025);
    await buildGsisXref(['11566'], map, 2025);
    expect(mockGroupBy).toHaveBeenCalledTimes(1);
  });

  // WHY: a failed index read should cost the name fallback, not the request.
  it('still resolves gsis_id players when the name index query fails', async () => {
    mockGroupBy.mockRejectedValue(new Error('libsql: connection closed'));
    const map = new Map([
      ['4046',  player('Patrick Mahomes', 'QB', '00-0033873')],
      ['11566', player('Jayden Daniels',  'QB')],
    ]);
    const xref = await buildGsisXref(['4046', '11566'], map, 2025);

    expect(xref.gsisIds).toEqual(['00-0033873']);
  });
});
