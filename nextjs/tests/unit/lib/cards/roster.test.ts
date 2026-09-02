// tests/unit/lib/cards/roster.test.ts
//
// Covers src/lib/cards/roster.ts — the lineup's shape, its eligibility rule,
// and the two scores derived from it.
//
// The eligibility rule is the one that matters most: the API guard and the UI's
// card picker both read `slotAccepts`, so if it were wrong in one direction the
// picker would hide legal cards, and in the other the server would accept a
// kicker at quarterback.

import { describe, it, expect } from '@jest/globals';
import {
  ROSTER_SLOTS, ROSTER_SIZE, ROSTER_SLOT_IDS, FLEX_POSITIONS,
  findSlot, slotAccepts, layoutRoster, rosterPointsPerGame, deckAveragePointsPerGame,
  type RosterScorable,
} from '@/lib/cards/roster';

const card = (id: string, position: string, ppg: number): RosterScorable => ({
  id, position, pointsPerGame: ppg, tier: 'BRONZE',
});

describe('the lineup', () => {
  // WHY: this is the spec, restated. QB, RB, RB, WR, WR, TE, FLEX, FLEX, FLEX.
  it('is nine slots in the order asked for', () => {
    expect(ROSTER_SLOTS.map((s) => s.id)).toEqual([
      'QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX1', 'FLEX2', 'FLEX3',
    ]);
    expect(ROSTER_SIZE).toBe(9);
  });

  it('labels the paired slots identically', () => {
    const labels = ROSTER_SLOTS.map((s) => s.label);
    expect(labels).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX']);
  });

  // WHY: kickers and defenses are not cards any more, so a slot for either
  //      would be permanently unfillable.
  it('has no kicker or defense slot', () => {
    expect(ROSTER_SLOT_IDS).not.toContain('K');
    expect(ROSTER_SLOT_IDS).not.toContain('DEF');
  });

  it('gives a third of the lineup to FLEX', () => {
    expect(ROSTER_SLOTS.filter((s) => s.label === 'FLEX')).toHaveLength(3);
  });

  it('has no duplicate slot ids', () => {
    expect(new Set(ROSTER_SLOT_IDS).size).toBe(ROSTER_SLOT_IDS.length);
  });
});

describe('slotAccepts()', () => {
  // WHY: a FLEX takes RB, WR or TE — and nothing else. A quarterback or a
  //      defense sliding into a FLEX would break the whole point of the slot.
  it('lets RB, WR and TE into a FLEX', () => {
    for (const position of FLEX_POSITIONS) {
      expect(slotAccepts('FLEX1', position)).toBe(true);
      expect(slotAccepts('FLEX2', position)).toBe(true);
    }
  });

  it('keeps quarterbacks out of a FLEX', () => {
    expect(slotAccepts('FLEX1', 'QB')).toBe(false);
    expect(slotAccepts('FLEX2', 'QB')).toBe(false);
    expect(slotAccepts('FLEX3', 'QB')).toBe(false);
  });

  it('locks the dedicated slots to their own position', () => {
    expect(slotAccepts('QB', 'QB')).toBe(true);
    expect(slotAccepts('QB', 'RB')).toBe(false);
    expect(slotAccepts('TE', 'WR')).toBe(false);
    expect(slotAccepts('WR1', 'RB')).toBe(false);
  });

  // WHY: the positions were removed from the pool, so nothing should still
  //      accept them — a stale `accepts` entry would be a slot nobody can fill.
  it('accepts no kicker or defense anywhere', () => {
    for (const slot of ROSTER_SLOT_IDS) {
      expect(slotAccepts(slot, 'K')).toBe(false);
      expect(slotAccepts(slot, 'DEF')).toBe(false);
    }
  });

  it('accepts the same position in either of a paired slot', () => {
    expect(slotAccepts('RB1', 'RB')).toBe(true);
    expect(slotAccepts('RB2', 'RB')).toBe(true);
    expect(slotAccepts('WR1', 'WR')).toBe(true);
    expect(slotAccepts('WR2', 'WR')).toBe(true);
  });

  // WHY: an unknown slot must refuse rather than default to allowing, since
  //      this is what the API guard leans on.
  it('refuses a slot that does not exist', () => {
    expect(slotAccepts('BENCH', 'RB')).toBe(false);
    expect(findSlot('BENCH')).toBeNull();
  });
});

describe('layoutRoster()', () => {
  // WHY: the UI draws an empty slot as something you can click, so every slot
  //      has to come back whether it is filled or not.
  it('returns all ten slots in order, empties included', () => {
    const laid = layoutRoster(new Map([['QB', card('c1', 'QB', 22)]]));

    expect(laid).toHaveLength(ROSTER_SIZE);
    expect(laid[0].card?.id).toBe('c1');
    expect(laid.filter((s) => s.card === null)).toHaveLength(ROSTER_SIZE - 1);
    expect(laid.map((s) => s.slot.id)).toEqual(ROSTER_SLOT_IDS);
  });

  it('returns ten empty slots for an untouched lineup', () => {
    const laid = layoutRoster(new Map());
    expect(laid).toHaveLength(ROSTER_SIZE);
    expect(laid.every((s) => s.card === null)).toBe(true);
  });
});

describe('rosterPointsPerGame()', () => {
  // WHY: a sum, not an average — a lineup's score is what it would put up in a
  //      week. Averaging would make a one-man roster look like a full one.
  it('sums the starters', () => {
    expect(rosterPointsPerGame([
      card('a', 'QB', 22.8), card('b', 'RB', 21.3), card('c', 'WR', 8),
    ])).toBe(52.1);
  });

  it('scores an empty lineup at zero', () => {
    expect(rosterPointsPerGame([])).toBe(0);
  });

  it('scores a half-filled lineup below a full one', () => {
    const full = [card('a', 'QB', 20), card('b', 'RB', 15)];
    expect(rosterPointsPerGame(full.slice(0, 1))).toBeLessThan(rosterPointsPerGame(full));
  });

  it('rounds to one decimal so the UI never prints float noise', () => {
    expect(rosterPointsPerGame([card('a', 'QB', 0.1), card('b', 'RB', 0.2)])).toBe(0.3);
  });
});

describe('deckAveragePointsPerGame()', () => {
  // WHY: an average over the whole deck answers a different question from the
  //      lineup sum — how good is everything you pulled, not how good is your
  //      best ten. Hoarding good cards you cannot start still shows up here.
  it('averages every card owned', () => {
    expect(deckAveragePointsPerGame([
      { pointsPerGame: 10 }, { pointsPerGame: 20 }, { pointsPerGame: 30 },
    ])).toBe(20);
  });

  it('is zero rather than NaN for an empty deck', () => {
    const value = deckAveragePointsPerGame([]);
    expect(value).toBe(0);
    expect(Number.isNaN(value)).toBe(false);
  });

  // WHY: the two numbers must not be the same thing wearing different hats.
  it('falls when a weak card is added, where the lineup sum would not', () => {
    const deck = [{ pointsPerGame: 20 }, { pointsPerGame: 20 }];
    expect(deckAveragePointsPerGame([...deck, { pointsPerGame: 2 }]))
      .toBeLessThan(deckAveragePointsPerGame(deck));
  });
});
