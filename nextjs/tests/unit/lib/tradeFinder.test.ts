// tests/unit/lib/tradeFinder.test.ts
//
// Covers src/lib/tradeFinder.ts — reading a roster as a depth chart and pricing
// a trade against the lineup that has to play, rather than against the players
// in isolation.
//
// The unit under test is the arithmetic the trade panel's advice rests on: what
// a roster loses by sending a player out, what it gains by taking one in, and
// which of the several answers to one void get shown. The route test drives the
// same code through HTTP; this one pins the pieces the route cannot isolate.

import { describe, it, expect } from '@jest/globals';
import {
  buildRosterShape, lineupDelta, findTrades, fairness, describeTrade,
  positionStrength,
} from '@/lib/tradeFinder';
import type { RosterEntry, RosterShape } from '@/lib/tradeFinder';

// Two RB slots, one of everything else — the standard Sleeper lineup.
const SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1 };

/** Terse fixture builder: ['rb-1', 'RB', 300] → a RosterEntry. */
function entries(rows: [string, RosterEntry['position'], number][]): RosterEntry[] {
  return rows.map(([playerId, position, seasonPts]) =>
    ({ playerId, name: playerId.toUpperCase(), position, seasonPts }));
}

/** Deep at RB (four, two start), one QB, no tight end. */
function deepAtRb(ownerId = 'me'): RosterShape {
  return buildRosterShape(ownerId, entries([
    ['qb-1', 'QB', 320],
    ['rb-1', 'RB', 300], ['rb-2', 'RB', 250], ['rb-3', 'RB', 220], ['rb-4', 'RB', 190],
    ['wr-1', 'WR', 240], ['wr-2', 'WR', 210],
  ]), SLOTS);
}

describe('buildRosterShape()', () => {
  it('ranks each position by points and marks the starting slots', () => {
    const shape = deepAtRb();
    expect(shape.byPos.RB.map((p) => p.playerId)).toEqual(['rb-1', 'rb-2', 'rb-3', 'rb-4']);
    expect(shape.byPos.RB.map((p) => p.depthRank)).toEqual([1, 2, 3, 4]);
    expect(shape.byPos.RB.map((p) => p.starter)).toEqual([true, true, false, false]);
  });

  // WHY: the whole premise. A player behind the starter line is replaced by
  //      himself-plus-one when he leaves — the lineup does not change — so
  //      trading him costs nothing, and he is the piece to offer.
  it('prices a player behind the starter line at zero', () => {
    const shape = deepAtRb();
    expect(shape.byPos.RB.find((p) => p.playerId === 'rb-3')!.cost).toBe(0);
    expect(shape.byPos.RB.find((p) => p.playerId === 'rb-4')!.cost).toBe(0);
  });

  // WHY: and the corollary — a starter costs only the gap to the man behind
  //      him, not his whole total. An RB1 with a startable RB3 waiting is far
  //      cheaper to move than his 300 points suggest, which is exactly the
  //      judgement "trade the best player at the position" cannot make.
  it('prices a starter at the gap to his replacement, not his own total', () => {
    const shape = deepAtRb();
    // rb-1 leaves, rb-3 slides into the second slot: 550 → 470.
    expect(shape.byPos.RB.find((p) => p.playerId === 'rb-1')!.cost).toBe(80);
    // Nobody is behind qb-1, so the slot empties and he costs his whole total.
    expect(shape.byPos.QB.find((p) => p.playerId === 'qb-1')!.cost).toBe(320);
  });

  it('sums the starting lineup over the slots the league actually uses', () => {
    // 320 QB + (300 + 250) RB + (240 + 210) WR. rb-3 and rb-4 are not started.
    expect(deepAtRb().lineupPts).toBe(1320);
    expect(positionStrength(deepAtRb(), 'RB', SLOTS)).toBe(550);
    // One TE slot and no tight end is a hole worth its whole slot.
    expect(positionStrength(deepAtRb(), 'TE', SLOTS)).toBe(0);
  });
});

describe('lineupDelta()', () => {
  const shape = deepAtRb();

  it('counts an arrival into an empty slot at his full total', () => {
    expect(lineupDelta(shape, SLOTS, [], entries([['te-x', 'TE', 200]]))).toBe(200);
  });

  it('counts an arrival into a filled slot only for what he adds', () => {
    // A 260-point WR displaces wr-2 (210) from the second slot.
    expect(lineupDelta(shape, SLOTS, [], entries([['wr-x', 'WR', 260]]))).toBe(50);
  });

  it('is zero for a player who would not start', () => {
    expect(lineupDelta(shape, SLOTS, [], entries([['rb-x', 'RB', 100]]))).toBe(0);
  });

  // WHY: the two sides of a trade are one calculation, not two. Spending depth
  //      the lineup never fields on a starter it does not have is the trade the
  //      old finder could not describe.
  it('nets both sides of a trade in one number', () => {
    const give    = shape.byPos.RB.filter((p) => p.playerId === 'rb-3');
    const receive = entries([['te-x', 'TE', 200]]);
    expect(lineupDelta(shape, SLOTS, give, receive)).toBe(200);
  });

  // WHY: a league with no slot at a position gets no value from it. Kicker-less
  //      leagues exist, and a proposal built on one would be unreadable.
  it('values a position the league does not start at nothing', () => {
    const noKicker = { QB: 1, RB: 2, WR: 2, TE: 1 };
    expect(lineupDelta(shape, noKicker, [], entries([['k-x', 'K', 150]]))).toBe(0);
  });
});

describe('fairness()', () => {
  it('scores an even split at 100 and a giveaway near zero', () => {
    expect(fairness(200, 200)).toBe(100);
    expect(Math.round(fairness(100, 200))).toBe(50);
    expect(fairness(0, 300)).toBe(0);
  });
});

describe('findTrades()', () => {
  /** Two startable TEs where one starts; nothing at running back. */
  const teRich = buildRosterShape('te-rich', entries([
    ['qb-2', 'QB', 280],
    ['te-1', 'TE', 260], ['te-2', 'TE', 230],
    ['wr-3', 'WR', 180], ['wr-4', 'WR', 170],
  ]), SLOTS);

  /** Three startable WRs where two start; a weak RB2. */
  const wrRich = buildRosterShape('wr-rich', entries([
    ['qb-3', 'QB', 240],
    ['wr-5', 'WR', 320], ['wr-6', 'WR', 300], ['wr-7', 'WR', 270],
    ['te-3', 'TE', 240], ['rb-6', 'RB', 210], ['rb-7', 'RB', 150],
  ]), SLOTS);

  /** An elite tight end and no running backs at all. */
  const teElite = buildRosterShape('te-elite', entries([
    ['qb-4', 'QB', 210], ['te-4', 'TE', 420], ['te-5', 'TE', 200], ['wr-8', 'WR', 150],
  ]), SLOTS);

  const partners = [teRich, wrRich, teElite];

  // WHY: the request behind this module. One void, several ways to fill it —
  //      the finder should show more than one, from more than one partner.
  it('mixes partners and players rather than repeating one trade', () => {
    const found = findTrades(deepAtRb(), partners, SLOTS);

    expect(found.length).toBeGreaterThan(1);
    expect(new Set(found.map((c) => c.targetOwnerId)).size).toBeGreaterThan(1);
    expect(new Set(found.flatMap((c) => c.give.map((p) => p.playerId))).size)
      .toBeGreaterThan(1);
  });

  // WHY: both lineups have to come out ahead, or it is a proposal one side
  //      would never sign — which is the same as no proposal at all.
  it('returns only trades both rosters gain from', () => {
    for (const c of findTrades(deepAtRb(), partners, SLOTS)) {
      expect(c.myGain).toBeGreaterThan(0);
      expect(c.theirGain).toBeGreaterThan(0);
      expect(c.fairnessScore).toBeGreaterThanOrEqual(60);
    }
  });

  // WHY: an unbacked starter is not surplus at any price. Sending the only
  //      quarterback out to fill the tight end hole just moves the hole.
  it('never spends a starter it cannot replace', () => {
    const given = findTrades(deepAtRb(), partners, SLOTS)
      .flatMap((c) => c.give.map((p) => p.playerId));
    expect(given.length).toBeGreaterThan(0);
    expect(given).not.toContain('qb-1');
  });

  // WHY: an empty starting slot scores zero, so the arithmetic alone will happily
  //      trade the last body at a position away for a big enough return. The
  //      lineup still has to be submitted on Sunday.
  it('will not empty a starting slot the roster fills today', () => {
    const twoBacks = buildRosterShape('two-backs', entries([
      ['qb-a', 'QB', 300],
      ['rb-a', 'RB', 260], ['rb-b', 'RB', 240],
      ['wr-a', 'WR', 250], ['wr-b', 'WR', 230],
    ]), SLOTS);

    for (const c of findTrades(twoBacks, partners, SLOTS)) {
      const rbsOut = c.give.filter((p) => p.position === 'RB').length;
      const rbsIn  = c.receive.filter((p) => p.position === 'RB').length;
      // Two slots, two backs: neither may leave without one arriving.
      expect(2 - rbsOut + rbsIn).toBeGreaterThanOrEqual(2);
      expect(c.give.map((p) => p.playerId)).not.toContain('qb-a');
    }
  });

  // WHY: a 420-point tight end is out of reach of any single spare piece —
  //      220-for-420 scores 52 on fairness — but two of them together score 98
  //      and leave both lineups better off.
  it('packages spare pieces when no single player balances a star', () => {
    const forTheStar = findTrades(deepAtRb(), partners, SLOTS)
      .find((c) => c.receive.some((p) => p.playerId === 'te-4'));

    expect(forTheStar).toBeDefined();
    expect(forTheStar!.give.length).toBe(2);
    expect(forTheStar!.fairnessScore).toBeGreaterThanOrEqual(60);
  });

  it('ranks the returned list by the value the deal creates', () => {
    const found = findTrades(deepAtRb(), partners, SLOTS);
    const totals = found.map((c) => c.myGain + c.theirGain);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  // WHY: season totals are noisy enough that a handful of points is not a
  //      reason to trade, and a shortlist padded with them stops being one.
  it('ignores gains too small to be worth proposing', () => {
    // A marginal upgrade: 5 points on a 1320-point lineup, and nothing else on
    // offer that either side can use.
    const marginal = buildRosterShape('marginal', entries([
      ['wr-9', 'WR', 245], ['rb-9', 'RB', 240],
    ]), SLOTS);

    expect(findTrades(deepAtRb(), [marginal], SLOTS)).toEqual([]);
  });

  it('returns nothing when there is no partner to trade with', () => {
    expect(findTrades(deepAtRb(), [], SLOTS)).toEqual([]);
    // A roster does not trade with itself, however lopsided it is.
    expect(findTrades(deepAtRb(), [deepAtRb()], SLOTS)).toEqual([]);
  });

  it('honours the requested limit', () => {
    expect(findTrades(deepAtRb(), partners, SLOTS, 2).length).toBeLessThanOrEqual(2);
  });
});

describe('describeTrade()', () => {
  // WHY: "your RB3" is the reason the finder picked him; "your RB" is not, and
  //      is what the summary used to say.
  it('names the depth slot moving and what the lineup gets for it', () => {
    const found = findTrades(deepAtRb(), [buildRosterShape('te-rich', entries([
      ['te-1', 'TE', 260], ['te-2', 'TE', 230], ['wr-3', 'WR', 180],
    ]), SLOTS)], SLOTS);

    expect(found.length).toBeGreaterThan(0);
    const line = describeTrade(found[0]);
    expect(line).toMatch(/(QB|RB|WR|TE|K)[1-9]/);
    expect(line).toMatch(/\+\d+ pts to your starters/);
  });
});
