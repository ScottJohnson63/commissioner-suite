// tests/unit/lib/league.test.ts
//
// Covers src/lib/league.ts — resolving a league from either of its two IDs.
//
// Six routes accept whichever ID the client happened to hold (the internal cuid
// or the Sleeper league ID). The `OR` clause that makes that work was copied
// into each of them; these tests pin the shared version.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/prisma', () => ({
  prisma: { league: { findFirst: jest.fn() } },
}));

import { leagueWhere, findLeagueByAnyId, findLeagueIdByAnyId } from '@/lib/league';
import { prisma } from '@/lib/prisma';

const mockFindFirst = prisma.league.findFirst as jest.MockedFunction<typeof prisma.league.findFirst>;

describe('leagueWhere()', () => {
  // WHY: both branches must be present. Dropping either one silently breaks
  //      every caller that passes the other kind of ID.
  it('matches on the internal id or the Sleeper league id', () => {
    expect(leagueWhere('abc')).toEqual({ OR: [{ id: 'abc' }, { sleeperLeagueId: 'abc' }] });
  });
});

describe('findLeagueByAnyId()', () => {
  beforeEach(() => { mockFindFirst.mockReset(); });

  it('queries with the shared where clause', async () => {
    mockFindFirst.mockResolvedValue({ id: 'db-1' } as never);

    await findLeagueByAnyId('1389376288136908800');

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: '1389376288136908800' }, { sleeperLeagueId: '1389376288136908800' }] },
    });
  });

  it('returns null when nothing matches', async () => {
    mockFindFirst.mockResolvedValue(null as never);
    expect(await findLeagueByAnyId('nope')).toBeNull();
  });
});

describe('findLeagueIdByAnyId()', () => {
  beforeEach(() => { mockFindFirst.mockReset(); });

  // WHY: callers that only need a foreign key should not pull every column.
  it('selects only the internal id', async () => {
    mockFindFirst.mockResolvedValue({ id: 'db-1' } as never);

    const id = await findLeagueIdByAnyId('abc');

    expect(id).toBe('db-1');
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: 'abc' }, { sleeperLeagueId: 'abc' }] },
      select: { id: true },
    });
  });

  // WHY: the audit routes fall back to the raw request value when the league is
  //      unknown, so this has to be null rather than undefined or a throw.
  it('returns null for an unknown league', async () => {
    mockFindFirst.mockResolvedValue(null as never);
    expect(await findLeagueIdByAnyId('nope')).toBeNull();
  });
});
