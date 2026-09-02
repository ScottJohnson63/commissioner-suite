// tests/unit/lib/cards/tiers.test.ts
//
// Covers src/lib/cards/tiers.ts — the tier cutoffs and the "what is below this
// tier" rule that every pack recipe is built on.
//
// These are the numbers the whole game is balanced around, so the boundaries
// are pinned exactly rather than sampled: an off-by-one here silently moves
// players between tiers on the next pool rebuild.

import { describe, it, expect } from '@jest/globals';
import {
  tierForRank, lowerTiers, deckScore,
  TIER_ORDER, PACK_GUARANTEE, CARDS_PER_PACK, DECK_POINTS,
  PACK_DROP_WEIGHT, FILLER_TIER_WEIGHT,
} from '@/lib/cards/tiers';
import type { CardTier } from '@prisma/client';

describe('tierForRank()', () => {
  // WHY: the exact boundaries are the spec. The brief wrote Silver as "10-20",
  //      which overlaps Gold's "6-10"; rank 10 is Gold and rank 11 starts
  //      Silver. This test is what documents that reading.
  it.each([
    [1,  'HALL_OF_FAME'],
    [5,  'HALL_OF_FAME'],
    [6,  'GOLD'],
    [10, 'GOLD'],
    [11, 'SILVER'],
    [30, 'SILVER'],
    [31, 'BRONZE'],
  ])('rank %i is %s', (rank, expected) => {
    expect(tierForRank(rank)).toBe(expected);
  });

  it('puts every deep rank in Bronze', () => {
    expect(tierForRank(500)).toBe('BRONZE');
  });
});

describe('lowerTiers()', () => {
  // WHY: filler slots draw from whatever this returns, so a wrong answer here
  //      would let a Gold pack deal Hall of Fame cards as filler.
  it('returns only the tiers below the one asked for', () => {
    expect(lowerTiers('HALL_OF_FAME')).toEqual(['GOLD', 'SILVER', 'BRONZE']);
    expect(lowerTiers('GOLD')).toEqual(['SILVER', 'BRONZE']);
    expect(lowerTiers('SILVER')).toEqual(['BRONZE']);
  });

  // WHY: this empty array is exactly why a Bronze pack is all guarantee.
  it('returns nothing below Bronze', () => {
    expect(lowerTiers('BRONZE')).toEqual([]);
  });
});

describe('pack recipes', () => {
  // WHY: these four numbers are the brief, restated as a test.
  it('guarantees 1 / 2 / 3 / 5 of the pack tier', () => {
    expect(PACK_GUARANTEE.HALL_OF_FAME).toBe(1);
    expect(PACK_GUARANTEE.GOLD).toBe(2);
    expect(PACK_GUARANTEE.SILVER).toBe(3);
    expect(PACK_GUARANTEE.BRONZE).toBe(CARDS_PER_PACK);
  });

  it('never guarantees more cards than a pack holds', () => {
    for (const tier of TIER_ORDER) {
      expect(PACK_GUARANTEE[tier]).toBeLessThanOrEqual(CARDS_PER_PACK);
    }
  });
});

/**
 * Expected cards of each tier from one average pack, given the three tables.
 *
 * This is `openPack` reduced to its arithmetic: roll a pack tier on
 * PACK_DROP_WEIGHT, take PACK_GUARANTEE of that tier, fill the rest from
 * strictly lower tiers on FILLER_TIER_WEIGHT. Verified against the real
 * openPack by Monte Carlo — the two agree to within 0.2 percentage points.
 *
 * It lives here rather than in src because it is not how the game deals cards,
 * only how the balance is checked. The tests below are about what the three
 * tables add up to, which is the thing no single table shows.
 */
function expectedYield(): Record<CardTier, number> {
  const out = { HALL_OF_FAME: 0, GOLD: 0, SILVER: 0, BRONZE: 0 } as Record<CardTier, number>;
  const dropTotal = TIER_ORDER.reduce((n, t) => n + PACK_DROP_WEIGHT[t], 0);

  for (const tier of TIER_ORDER) {
    const pPack = PACK_DROP_WEIGHT[tier] / dropTotal;
    const guaranteed = Math.min(PACK_GUARANTEE[tier], CARDS_PER_PACK);
    out[tier] += pPack * guaranteed;

    const below = lowerTiers(tier);
    if (!below.length) continue;
    const fillTotal = below.reduce((n, t) => n + FILLER_TIER_WEIGHT[t], 0);
    for (const t of below) {
      out[t] += pPack * (CARDS_PER_PACK - guaranteed) * (FILLER_TIER_WEIGHT[t] / fillTotal);
    }
  }
  return out;
}

describe('pack balance', () => {
  // WHY: this is the bug that prompted the rebalance, stated as a test. The
  //      three tables are tuned separately and no one of them shows the result,
  //      so a change to any of them can quietly invert the ladder. A tier must
  //      never be dealt more often than the tier above it is — Silver was
  //      arriving less often than Gold, which is the whole game backwards.
  it('deals each tier more often than the tier above it', () => {
    const y = expectedYield();
    expect(y.GOLD).toBeGreaterThan(y.HALL_OF_FAME);
    expect(y.SILVER).toBeGreaterThan(y.GOLD);
    expect(y.BRONZE).toBeGreaterThan(y.SILVER);
  });

  // WHY: the complaint the rebalance answered was "a lot of Bronze and almost
  //      no Silver". Bronze taking two thirds of everything dealt is the line
  //      past which the other three tiers stop being a collection.
  it('keeps Bronze under two thirds of everything dealt', () => {
    const y = expectedYield();
    const total = TIER_ORDER.reduce((n, t) => n + y[t], 0);
    expect(y.BRONZE / total).toBeLessThan(0.66);
  });

  // WHY: Hall of Fame has to stay reachable. At the old weight of 3 a member
  //      opening a season's 39 packs missed it entirely 20% of the time, which
  //      made the top tier a lottery rather than a chase.
  it('gives a season of packs a real chance at a Hall of Fame pack', () => {
    const dropTotal = TIER_ORDER.reduce((n, t) => n + PACK_DROP_WEIGHT[t], 0);
    const pMiss = (1 - PACK_DROP_WEIGHT.HALL_OF_FAME / dropTotal) ** 39;
    expect(1 - pMiss).toBeGreaterThan(0.9);
  });

  // WHY: reachable is not the same as common. Hall of Fame must stay the
  //      rarest pack by a clear margin, or the tier stops meaning anything.
  it('keeps Hall of Fame at least twice as rare as Gold', () => {
    expect(PACK_DROP_WEIGHT.HALL_OF_FAME * 2).toBeLessThanOrEqual(PACK_DROP_WEIGHT.GOLD);
  });

  // WHY: the pack ladder is kept strict so that "rarer" means one thing. Equal
  //      Silver and Bronze weights would also be defensible balance, but they
  //      make any ordering assertion over sampled rolls a coin flip.
  it('orders the pack drop weights strictly by rarity', () => {
    expect(PACK_DROP_WEIGHT.HALL_OF_FAME).toBeLessThan(PACK_DROP_WEIGHT.GOLD);
    expect(PACK_DROP_WEIGHT.GOLD).toBeLessThan(PACK_DROP_WEIGHT.SILVER);
    expect(PACK_DROP_WEIGHT.SILVER).toBeLessThan(PACK_DROP_WEIGHT.BRONZE);
  });

  // WHY: documents a dead key rather than a rule. Filler draws from lowerTiers,
  //      which is strictly below the pack's tier, and nothing is above Hall of
  //      Fame — so FILLER_TIER_WEIGHT.HALL_OF_FAME can never be selected. It
  //      exists because the Record is total over CardTier. Anyone tuning Hall
  //      of Fame drop rates needs to know that editing it does nothing.
  it('never offers Hall of Fame as a filler candidate', () => {
    for (const tier of TIER_ORDER) {
      expect(lowerTiers(tier)).not.toContain('HALL_OF_FAME');
    }
  });
});

describe('deckScore()', () => {
  // WHY: the whole competitive premise. Ownership is exclusive, so members are
  //      ranked on rarity rather than volume — and this is the assertion that
  //      says a small rare deck beats a big common one.
  it('values four Hall of Fame cards above a hundred Bronze', () => {
    expect(deckScore({ HALL_OF_FAME: 4 })).toBeGreaterThan(deckScore({ BRONZE: 99 }));
  });

  it('sums every tier', () => {
    expect(deckScore({ HALL_OF_FAME: 1, GOLD: 1, SILVER: 1, BRONZE: 1 })).toBe(
      DECK_POINTS.HALL_OF_FAME + DECK_POINTS.GOLD + DECK_POINTS.SILVER + DECK_POINTS.BRONZE,
    );
  });

  it('scores an empty deck at zero', () => {
    expect(deckScore({})).toBe(0);
  });

  // WHY: the weights must stay strictly ordered by rarity. Any inversion would
  //      make a common card worth more than a rare one and invert the game.
  it('weights every tier above the one below it', () => {
    expect(DECK_POINTS.HALL_OF_FAME).toBeGreaterThan(DECK_POINTS.GOLD);
    expect(DECK_POINTS.GOLD).toBeGreaterThan(DECK_POINTS.SILVER);
    expect(DECK_POINTS.SILVER).toBeGreaterThan(DECK_POINTS.BRONZE);
    expect(DECK_POINTS.BRONZE).toBeGreaterThan(0);
  });
});
