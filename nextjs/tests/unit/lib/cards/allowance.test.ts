// tests/unit/lib/cards/allowance.test.ts
//
// Covers the weekly ration and the wildcard die in src/lib/cards/allowance.ts.
//
// The ration is a flat number now, so most of the interesting logic is in the
// die: it must stay on its six faces, and it must be throwable only once a
// week. That second one is a correctness property rather than a balance one — a
// die that can be rerolled is not a wildcard, it is unlimited packs.
//
// The one rule left on the ration itself is that week 1 does not pay one, which
// is pinned both at packsForWeek and at the row ensureGrant actually writes.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockUpdateMany = jest.fn<() => Promise<{ count: number }>>();
const mockFindUnique = jest.fn<() => Promise<unknown>>();
// Forwards its argument, unlike the mocks around it: the week-1 ration rule is
// only observable in the row ensureGrant asks Prisma to create.
const mockUpsert = jest.fn<(args?: unknown) => Promise<unknown>>();
const mockStarterUpsert = jest.fn<() => Promise<unknown>>();
const mockWildUpdateMany = jest.fn<() => Promise<{ count: number }>>();
const mockWildFindFirst = jest.fn<() => Promise<unknown>>();
const mockWildFindMany = jest.fn<() => Promise<unknown[]>>();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    cardDefinition: { count: jest.fn() },
    cardOwnership: { count: jest.fn() },
    user: { count: jest.fn() },
    starterGrant: { upsert: () => mockStarterUpsert() },
    packGrant: {
      updateMany: () => mockUpdateMany(),
      findUnique: () => mockFindUnique(),
      upsert: (args: unknown) => mockUpsert(args),
    },
    wildcardCard: {
      updateMany: () => mockWildUpdateMany(),
      findFirst: () => mockWildFindFirst(),
      findMany: () => mockWildFindMany(),
    },
  },
}));

import {
  PACKS_PER_WEEK, FIRST_RATION_WEEK, GUARANTEED_GOLD_PACKS, STARTER_PACKS,
  STARTER_GUARANTEED_GOLD, WILDCARD_SIDES, rollWildcard, claimWildcard,
  pendingWildcards, ensureStarterGrant, ensureGrant, packsForWeek, gameSeason,
} from '@/lib/cards/allowance';

beforeEach(() => { jest.clearAllMocks(); });

describe('the supplies', () => {
  // WHY: the ration carries no Gold guarantee, and that zero is load-bearing.
  //      At a two-pack ration a quota of one forced 85% of second packs to
  //      Gold, which made Gold cards commoner than Silver and inverted the
  //      rarity ladder. PACK_DROP_WEIGHT is tuned assuming every ration pack
  //      rolls freely, so restoring a quota here silently undoes that table.
  it('gives two packs a week, none of them a guaranteed Gold', () => {
    expect(PACKS_PER_WEEK).toBe(2);
    expect(GUARANTEED_GOLD_PACKS).toBe(0);
  });

  // WHY: the welcome grant is the whole first impression. Five packs of mostly
  //      Bronze leaves a new member with nothing to field.
  it('gives five one-off starter packs, two guaranteed Gold or better', () => {
    expect(STARTER_PACKS).toBe(5);
    expect(STARTER_GUARANTEED_GOLD).toBe(2);
  });

  // WHY: the two quotas must stay independent. If the starter quota ever
  //      exceeded its own pack count the pity timer could never satisfy it.
  it('never promises more Gold than a supply has packs', () => {
    expect(STARTER_GUARANTEED_GOLD).toBeLessThanOrEqual(STARTER_PACKS);
    expect(GUARANTEED_GOLD_PACKS).toBeLessThanOrEqual(PACKS_PER_WEEK);
  });

  // WHY: a guarantee is only a floor while it is a minority of the supply. Past
  //      half, the pity timer stops topping the supply up and starts deciding
  //      what it mostly is — which is exactly how the ration's quota of one
  //      turned half the game into Gold packs. The starter grant sits at 2 of
  //      5 and is fine; this is the rule that catches the next one.
  it('keeps every Gold guarantee below half its supply', () => {
    expect(STARTER_GUARANTEED_GOLD / STARTER_PACKS).toBeLessThan(0.5);
    expect(GUARANTEED_GOLD_PACKS / PACKS_PER_WEEK).toBeLessThan(0.5);
  });
});

describe('packsForWeek()', () => {
  // WHY: the whole week-1 rule. A member's first week is the five starter packs
  //      and nothing else — a ration on top would make week 1 the biggest week
  //      of the season, which is backwards.
  it('pays no ration in week 1', () => {
    expect(packsForWeek(1)).toBe(0);
  });

  // WHY: "after week 1" means the ration starts with week 2 and never stops.
  it('pays the full ration from week 2 to the end of the season', () => {
    for (let week = FIRST_RATION_WEEK; week <= 18; week++) {
      expect(packsForWeek(week)).toBe(PACKS_PER_WEEK);
    }
  });
});

describe('ensureGrant()', () => {
  // WHY: the rule has to reach the row that is actually written. A week-1 row
  //      created at PACKS_PER_WEEK would hand out the ration anyway, however
  //      packsForWeek reads.
  it('creates the week 1 grant with no ration packs', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({ packsGranted: 0 });

    await ensureGrant('u1', 2026, 1);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ packsGranted: 0 }) }),
    );
  });

  it('creates a later week with the weekly ration', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({ packsGranted: PACKS_PER_WEEK });

    await ensureGrant('u1', 2026, 2);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ packsGranted: PACKS_PER_WEEK }),
      }),
    );
  });
});

describe('ensureStarterGrant()', () => {
  // WHY: once per member per season, and the upsert is what enforces it — two
  //      tabs loading the page together must not both grant five packs.
  it('upserts on (user, season) so it cannot be granted twice', async () => {
    mockStarterUpsert.mockResolvedValue({ packsGranted: STARTER_PACKS, packsOpened: 0 });

    const grant = await ensureStarterGrant('u1', 2026);

    expect(grant).toMatchObject({ packsGranted: STARTER_PACKS });
    expect(mockStarterUpsert).toHaveBeenCalledTimes(1);
  });
});

describe('rollWildcard()', () => {
  // WHY: the die is what turns a fixed ration into something worth showing up
  //      for, and its range is the whole promise — "1-6 extra packs".
  it('only ever lands on a face of the die', () => {
    for (let i = 0; i < 2_000; i++) {
      const value = rollWildcard();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(WILDCARD_SIDES);
    }
  });

  // WHY: `Math.floor(rng() * 6)` off by one at either end is the classic way to
  //      produce a die that rolls 0 or 7. Both extremes are pinned exactly.
  it('maps the extremes of the RNG onto 1 and 6', () => {
    expect(rollWildcard(() => 0)).toBe(1);
    expect(rollWildcard(() => 0.999999)).toBe(WILDCARD_SIDES);
  });

  it('reaches every face', () => {
    const seen = new Set(Array.from({ length: 500 }, () => rollWildcard()));
    expect(seen.size).toBe(WILDCARD_SIDES);
  });
});

describe('claimWildcard()', () => {
  beforeEach(() => {
    mockUpsert.mockResolvedValue({ packsGranted: PACKS_PER_WEEK });
    mockFindUnique.mockResolvedValue({ packsGranted: PACKS_PER_WEEK });
  });

  it('adds the rolled value to the ration', async () => {
    mockWildUpdateMany.mockResolvedValue({ count: 1 });
    mockWildFindFirst.mockResolvedValue({ rolledValue: 4 });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique
      .mockResolvedValueOnce(null) // ensureGrant's lookup
      .mockResolvedValue({ packsGranted: PACKS_PER_WEEK + 4 });

    const result = await claimWildcard('u1', 'wc1', 2026, 3, () => 0.6);

    expect(result?.rolled).toBe(true);
    expect(result?.value).toBe(4);
    expect(result?.packsGranted).toBe(PACKS_PER_WEEK + 4);
  });

  // WHY: the guard that makes each die a one-throw card. A double-click or a
  //      retried fetch matches zero rows because `rolledValue: null` is in the
  //      where clause, and the caller is told the roll did not happen —
  //      reporting the roll that already stuck rather than an error.
  it('reports a second roll as not rolled, with the original value', async () => {
    mockWildUpdateMany.mockResolvedValue({ count: 0 });
    mockWildFindFirst.mockResolvedValue({ rolledValue: 5 });
    mockFindUnique.mockResolvedValue({ packsGranted: 15 });

    const result = await claimWildcard('u1', 'wc1', 2026, 3, () => 0.1);

    expect(result?.rolled).toBe(false);
    expect(result?.value).toBe(5);
    expect(result?.packsGranted).toBe(15);
  });

  // WHY: the ration must not move on a throw that did not happen. Crediting
  //      before checking the update count would pay out for any id at all.
  it('does not credit the ration when the die was already thrown', async () => {
    mockWildUpdateMany.mockResolvedValue({ count: 0 });
    mockWildFindFirst.mockResolvedValue({ rolledValue: 5 });
    mockFindUnique.mockResolvedValue({ packsGranted: 15 });
    mockUpdateMany.mockClear();

    await claimWildcard('u1', 'wc1', 2026, 3, () => 0.1);

    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  // WHY: `userId` is in the where clause, so somebody else's wildcard matches
  //      nothing — and so does an id that never existed. Both are null, which
  //      the route turns into a 404 rather than a fictional roll.
  it('returns null for a wildcard that is not the caller\'s', async () => {
    mockWildUpdateMany.mockResolvedValue({ count: 0 });
    mockWildFindFirst.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue({ packsGranted: PACKS_PER_WEEK });

    expect(await claimWildcard('u1', 'someone-elses', 2026, 3)).toBeNull();
  });
});

describe('pendingWildcards()', () => {
  it('lists the unthrown dice', async () => {
    mockWildFindMany.mockResolvedValue([{ id: 'wc1', week: 2 }, { id: 'wc2', week: 4 }]);
    expect(await pendingWildcards('u1', 2026)).toEqual([
      { id: 'wc1', week: 2 },
      { id: 'wc2', week: 4 },
    ]);
  });

  it('is empty for a member who has found none', async () => {
    mockWildFindMany.mockResolvedValue([]);
    expect(await pendingWildcards('u1', 2026)).toEqual([]);
  });
});

describe('gameSeason()', () => {
  it('follows NFL_SEASON', () => {
    // tests/setup.ts pins this to 2025 for the whole suite.
    expect(gameSeason()).toBe(2025);
  });
});
