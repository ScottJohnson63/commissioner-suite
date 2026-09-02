// tests/unit/lib/cards/packs.test.ts
//
// Covers src/lib/cards/packs.ts — the pack recipes and the odds behind them.
//
// This is the file worth testing hardest. Everything else in the game is
// bookkeeping; this decides what a member actually gets, it is driven by
// randomness, and a subtle bug in it looks exactly like bad luck. The injected
// RNG is what makes that testable: a fixed sequence turns "the odds are right"
// into an exact assertion.

import { describe, it, expect } from '@jest/globals';
import type { CardTier } from '@prisma/client';
import {
  makeRng, weightedPick, rollPackTier, openPack, rollAndOpen, toPool,
  rollsWildcard, weakestCardIndex,
  type CardPool, type PoolCard,
} from '@/lib/cards/packs';
import {
  CARDS_PER_PACK, PACK_GUARANTEE, TIER_ORDER,
  WILDCARD_PACK_TIERS, WILDCARD_PULL_CHANCE,
} from '@/lib/cards/tiers';

/** A pool with `n` distinct cards in every tier. */
function fullPool(n = 30): CardPool {
  const cards: PoolCard[] = [];
  for (const tier of TIER_ORDER) {
    for (let i = 0; i < n; i++) cards.push({ id: `${tier}-${i}`, tier });
  }
  return toPool(cards);
}

/** An RNG that walks a fixed list, then repeats it. */
function sequence(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('makeRng()', () => {
  // WHY: the seed is what lets a disputed pull be replayed. If the generator
  //      is not deterministic, none of the tests below mean anything either.
  it('is deterministic for a given seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('produces different streams for different seeds', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it('stays within [0, 1)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('weightedPick()', () => {
  it('picks in proportion to weight', () => {
    // 0.0 lands in the first bucket, 0.9 in the far end of the second.
    expect(weightedPick({ a: 10, b: 90 }, sequence([0.0]))).toBe('a');
    expect(weightedPick({ a: 10, b: 90 }, sequence([0.9]))).toBe('b');
  });

  // WHY: a zero-weight option that can still be returned would let an empty
  //      tier be rolled and deal nothing.
  it('never returns a zero-weighted key', () => {
    for (let i = 0; i < 50; i++) {
      expect(weightedPick({ a: 0, b: 1 }, makeRng(i))).toBe('b');
    }
  });

  it('returns null when everything weighs zero', () => {
    expect(weightedPick({ a: 0, b: 0 }, makeRng(1))).toBeNull();
    expect(weightedPick({}, makeRng(1))).toBeNull();
  });
});

describe('openPack() — recipes', () => {
  // WHY: this is the brief, one tier at a time. Each pack must contain at
  //      least its guaranteed count of its own tier and never anything rarer.
  it.each(TIER_ORDER)('a %s pack honours its guarantee', (tier) => {
    for (let seed = 1; seed <= 60; seed++) {
      const cards = openPack(tier as CardTier, fullPool(), makeRng(seed));

      expect(cards).toHaveLength(CARDS_PER_PACK);

      const ownTier = cards.filter((c) => c.tier === tier).length;
      expect(ownTier).toBeGreaterThanOrEqual(PACK_GUARANTEE[tier as CardTier]);

      // Nothing above the pack's own tier may ever appear.
      const rarerThanPack = cards.filter(
        (c) => TIER_ORDER.indexOf(c.tier) < TIER_ORDER.indexOf(tier as CardTier),
      );
      expect(rarerThanPack).toEqual([]);
    }
  });

  // WHY: called out separately in the brief — "Bronze packs contain only
  //      bronze cards" — and it is the one pack with no filler at all.
  it('a Bronze pack is five Bronze cards', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const cards = openPack('BRONZE', fullPool(), makeRng(seed));
      expect(cards).toHaveLength(5);
      expect(cards.every((c) => c.tier === 'BRONZE')).toBe(true);
    }
  });

  it('does not repeat a card within one pack when the pool allows', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const cards = openPack('HALL_OF_FAME', fullPool(), makeRng(seed));
      expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    }
  });

  // WHY: the pool is thin before older seasons are backfilled, and a pack that
  //      silently deals three cards is worse than one that repeats.
  it('still deals five cards from a pool too small to fill one', () => {
    const tiny = toPool([
      { id: 'hof-1', tier: 'HALL_OF_FAME' },
      { id: 'bronze-1', tier: 'BRONZE' },
    ]);
    const cards = openPack('HALL_OF_FAME', tiny, makeRng(3));
    expect(cards).toHaveLength(CARDS_PER_PACK);
  });

  it('falls back to its own tier when every lower tier is empty', () => {
    const onlyGold = toPool([
      { id: 'g1', tier: 'GOLD' }, { id: 'g2', tier: 'GOLD' }, { id: 'g3', tier: 'GOLD' },
    ]);
    const cards = openPack('GOLD', onlyGold, makeRng(11));
    expect(cards).toHaveLength(CARDS_PER_PACK);
    expect(cards.every((c) => c.tier === 'GOLD')).toBe(true);
  });

  it('deals the guaranteed card first, so the reveal can build to it', () => {
    const cards = openPack('HALL_OF_FAME', fullPool(), makeRng(5));
    expect(cards[0].tier).toBe('HALL_OF_FAME');
  });
});

describe('rollPackTier()', () => {
  // WHY: rolling a tier the pool cannot fill would burn a member's pack and
  //      hand back something that looks like a bug.
  it('never rolls a tier with no cards', () => {
    const bronzeOnly = toPool([{ id: 'b1', tier: 'BRONZE' }]);
    for (let seed = 1; seed <= 50; seed++) {
      expect(rollPackTier(bronzeOnly, makeRng(seed))).toBe('BRONZE');
    }
  });

  it('returns null for an empty pool', () => {
    expect(rollPackTier(toPool([]), makeRng(1))).toBeNull();
  });

  // WHY: the drop weights are a balance decision (Bronze 40, HOF 8). This
  //      checks the ordering actually holds in practice rather than trusting
  //      the constants to be wired up correctly. The bounds are deliberately
  //      loose — this test is here to catch a table that is not wired up, not
  //      to re-pin the balance, which tiers.test.ts owns.
  it('rolls Bronze far more often than Hall of Fame', () => {
    const pool = fullPool();
    const counts: Record<string, number> = {};
    const rng = makeRng(2024);
    for (let i = 0; i < 4_000; i++) {
      const tier = rollPackTier(pool, rng)!;
      counts[tier] = (counts[tier] ?? 0) + 1;
    }
    expect(counts.BRONZE).toBeGreaterThan(counts.SILVER);
    expect(counts.SILVER).toBeGreaterThan(counts.GOLD);
    expect(counts.GOLD).toBeGreaterThan(counts.HALL_OF_FAME);
    // ~8% of 4,000 with plenty of slack for the seed.
    expect(counts.HALL_OF_FAME).toBeGreaterThan(150);
    expect(counts.HALL_OF_FAME).toBeLessThan(500);
  });
});

describe('rollAndOpen()', () => {
  it('returns the rolled tier alongside its cards', () => {
    const opened = rollAndOpen(fullPool(), makeRng(9))!;
    expect(TIER_ORDER).toContain(opened.packTier);
    expect(opened.cards).toHaveLength(CARDS_PER_PACK);
  });

  it('returns null when there is nothing to deal', () => {
    expect(rollAndOpen(toPool([]), makeRng(1))).toBeNull();
  });
});

describe('toPool()', () => {
  it('buckets by tier and leaves empty tiers as empty arrays', () => {
    const pool = toPool([{ id: 'a', tier: 'GOLD' }, { id: 'b', tier: 'GOLD' }]);
    expect(pool.GOLD).toHaveLength(2);
    expect(pool.HALL_OF_FAME).toEqual([]);
    expect(pool.BRONZE).toEqual([]);
  });
});

describe('bonus packs', () => {
  // WHY: a Sleeper bonus pack is an ordinary pack now. It used to be ten cards
  //      with a Silver floor, which made it the most expensive thing in the
  //      game — a floored ten-card pack draws 3.26 Silver against an ordinary
  //      pack's 1.43, and Silver is the tier that empties first. The reward is
  //      the extra pack itself, not a better pack.
  //
  //      These assert the *absence* of the old machinery, which is the only
  //      way to catch it being reintroduced by a well-meaning change.
  it('is dealt from the same table as every other pack', () => {
    const seen = new Set(
      Array.from({ length: 400 }, (_, i) => rollPackTier(fullPool(), makeRng(i + 1))),
    );
    // Bronze included: that is the whole change.
    for (const tier of TIER_ORDER) expect(seen).toContain(tier);
  });

  it('is the same size as every other pack', () => {
    for (let seed = 1; seed <= 40; seed++) {
      expect(openPack('SILVER', fullPool(), makeRng(seed))).toHaveLength(CARDS_PER_PACK);
    }
  });

  // WHY: the guarantee and the rarity ceiling are properties of the recipe, not
  //      of the supply a pack came from, and must hold for every pack.
  it('keeps the tier guarantee and the rarity ceiling', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const cards = openPack('GOLD', fullPool(), makeRng(seed));
      expect(cards.filter((c) => c.tier === 'GOLD').length)
        .toBeGreaterThanOrEqual(PACK_GUARANTEE.GOLD);
      expect(cards.filter((c) => c.tier === 'HALL_OF_FAME')).toEqual([]);
    }
  });

  it('does not repeat a card when the pool allows', () => {
    const cards = openPack('SILVER', fullPool(60), makeRng(9));
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });
});

// ─── Wildcards ────────────────────────────────────────────────────────────────
//
// A wildcard is worth one to six extra packs, so which packs can carry one and
// which card it costs are both balance decisions, not details. The rate is
// asserted at its boundary rather than by sampling: a distribution test here
// would pass on an off-by-one that a member would feel over a season.

describe('rollsWildcard()', () => {
  it('never falls out of a Bronze pack', () => {
    // Even with an RNG that always hits, Bronze is not on the list.
    expect(rollsWildcard('BRONZE', () => 0)).toBe(false);
  });

  it.each(WILDCARD_PACK_TIERS)('can fall out of a %s pack', (tier) => {
    expect(rollsWildcard(tier, () => 0)).toBe(true);
  });

  // WHY: `<` not `<=`. At exactly the threshold the pull must miss, or the rate
  //      is fractionally higher than the constant says it is.
  it('misses at exactly the threshold and hits just below it', () => {
    expect(rollsWildcard('GOLD', () => WILDCARD_PULL_CHANCE)).toBe(false);
    expect(rollsWildcard('GOLD', () => WILDCARD_PULL_CHANCE - 1e-9)).toBe(true);
  });

  it('never hits on a roll of one', () => {
    for (const tier of TIER_ORDER) {
      expect(rollsWildcard(tier, () => 0.999999)).toBe(false);
    }
  });
});

describe('weakestCardIndex()', () => {
  // WHY: this is the whole reason the wildcard does not feel like a punishment.
  //      Displacing at random would sometimes eat the guaranteed Hall of Fame
  //      card the pack was opened for.
  it('never picks the rarest card', () => {
    const cards: PoolCard[] = [
      { id: 'a', tier: 'HALL_OF_FAME' },
      { id: 'b', tier: 'GOLD' },
      { id: 'c', tier: 'BRONZE' },
    ];
    expect(weakestCardIndex(cards)).toBe(2);
  });

  // WHY: openPack deals guarantee first, then filler. Among cards of the same
  //      tier the last one drawn is the most disposable.
  it('takes the last of several equally weak cards', () => {
    const cards: PoolCard[] = [
      { id: 'a', tier: 'GOLD' },
      { id: 'b', tier: 'BRONZE' },
      { id: 'c', tier: 'BRONZE' },
    ];
    expect(weakestCardIndex(cards)).toBe(2);
  });

  it('picks the only card in a one-card pack', () => {
    expect(weakestCardIndex([{ id: 'a', tier: 'HALL_OF_FAME' }])).toBe(0);
  });

  it('reports -1 for an empty pack', () => {
    expect(weakestCardIndex([])).toBe(-1);
  });

  // WHY: a Bronze pack is all guarantee and no filler, so every card ties.
  it('handles a pack that is entirely one tier', () => {
    const cards: PoolCard[] = Array.from({ length: CARDS_PER_PACK }, (_, i) => ({
      id: String(i), tier: 'BRONZE' as CardTier,
    }));
    expect(weakestCardIndex(cards)).toBe(CARDS_PER_PACK - 1);
  });
});
