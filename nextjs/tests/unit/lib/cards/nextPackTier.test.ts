// tests/unit/lib/cards/nextPackTier.test.ts
//
// Covers the pre-roll in src/lib/cards/service.ts — specifically the pool it
// rolls against.
//
// `ensureNextPackTier` takes an optional pre-loaded pool so that `openOnePack`,
// which already holds one, does not re-read the claimed-id set to rebuild the
// same thing a moment later. That set is up to ~10,000 rows and was being read
// twice per pack open; on Turso those are billed row reads, and the bill is why
// any of this exists.
//
// Two things are worth pinning: that supplying a pool really does skip the
// read, and that the pre-roll still rolls only against cards that are actually
// available — a saving that dealt a tier with nothing left in it would be a bad
// trade.

import { it, expect, jest, beforeEach } from '@jest/globals';

const mockOwnershipFindMany = jest.fn<() => Promise<{ cardId: string }[]>>();
const mockDefinitionFindMany = jest.fn<() => Promise<{ id: string; tier: string }[]>>();
const mockGrantUpdateMany = jest.fn<(a?: unknown) => Promise<unknown>>();
const mockGrantFindUnique = jest.fn<() => Promise<unknown>>();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    cardDefinition: { findMany: () => mockDefinitionFindMany() },
    cardOwnership:  { findMany: () => mockOwnershipFindMany() },
    packOpening:    { count: async () => 0 },
    packGrant: {
      updateMany: (a: unknown) => mockGrantUpdateMany(a),
      findUnique: () => mockGrantFindUnique(),
    },
  },
}));

// A member with one ration pack left and no starter or bonus waiting, so
// nextSupply lands on RATION — whose Gold quota is zero, which makes
// mustForceGold return before it reads anything and leaves the roll genuine.
jest.mock('@/lib/cards/allowance', () => ({
  ensureGrant: async () => ({
    gameSeason: 2026, week: 3, packsGranted: 1, packsOpened: 0,
    bonusGranted: 0, bonusOpened: 0, nextPackTier: null,
  }),
  ensureStarterGrant: async () => ({ packsGranted: 5, packsOpened: 5 }),
  currentAllowance: async () => ({
    poolSize: 0, claimed: 0, remainingCards: 0, members: 1, perWeek: 2,
  }),
  gameSeason: () => 2026,
  pendingWildcards: async () => [],
  ensureNextPackTier: undefined,
  FIRST_RATION_WEEK: 2,
  GUARANTEED_GOLD_PACKS: 0,
  STARTER_GUARANTEED_GOLD: 2,
}));

import { ensureNextPackTier } from '@/lib/cards/service';
import { toPool } from '@/lib/cards/packs';
import type { CardTier } from '@prisma/client';

/** `count` cards of one tier, ids prefixed by that tier. */
function cards(tier: CardTier, count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `${tier}-${i + 1}`, tier }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGrantFindUnique.mockResolvedValue({ nextPackTier: null });
  mockDefinitionFindMany.mockResolvedValue(cards('BRONZE', 5));
  mockOwnershipFindMany.mockResolvedValue([]);
});

// WHY: the saving itself. openOnePack has already paid for the claimed-id set
//      once; handing the pool over must mean it is not read a second time
//      inside the same request.
it('does not re-read the claimed ids when given a pool', async () => {
  await ensureNextPackTier('u1', 2026, 3, () => 0.5, toPool(cards('BRONZE', 3)));

  expect(mockOwnershipFindMany).not.toHaveBeenCalled();
  expect(mockDefinitionFindMany).not.toHaveBeenCalled();
});

// WHY: the readAllowance path has no pool to hand over, and must keep loading
//      one. An optional parameter that silently changed that behaviour would
//      leave every page load rolling against an empty pool.
it('still loads the pool when none is supplied', async () => {
  await ensureNextPackTier('u1', 2026, 3, () => 0.5);

  expect(mockOwnershipFindMany).toHaveBeenCalledTimes(1);
});

// WHY: the correctness constraint on the saving. The pool a pack was drawn from
//      still contains that pack's own cards, so the caller filters them out
//      before handing it over — an unfiltered reuse could roll a tier whose
//      last cards this very pack just took, and openPack would then find
//      nothing behind the tier the roll promised.
it('rolls only against tiers the supplied pool still has', async () => {
  // Gold is present but empty — as it would be after a pack claimed the last of
  // it — so the roll has only Bronze to land on, whatever the die says.
  const pool = toPool(cards('BRONZE', 4));

  for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
    mockGrantUpdateMany.mockClear();
    await ensureNextPackTier('u1', 2026, 3, () => roll, pool);

    const written = mockGrantUpdateMany.mock.calls[0]?.[0] as
      { data: { nextPackTier: CardTier } } | undefined;
    expect(written?.data.nextPackTier).toBe('BRONZE');
  }
});

// WHY: an empty pool is the one case with genuinely no next pack. It must
//      report that rather than writing a tier nothing can fill.
it('returns null for a pool with nothing left', async () => {
  expect(await ensureNextPackTier('u1', 2026, 3, () => 0.5, toPool([]))).toBeNull();
  expect(mockGrantUpdateMany).not.toHaveBeenCalled();
});
