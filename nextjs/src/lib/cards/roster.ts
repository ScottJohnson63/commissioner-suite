// src/lib/cards/roster.ts
//
// The starting lineup: what its slots are, what may go in them, and what it
// scores.
//
// A member's *deck* is everything they own. Their *roster* is the nine cards
// they field, and it is the roster that decides the standings — owning a second
// elite running back is worth nothing if a better one already holds the slot.
// That split is the whole reason the game has a lineup at all: it turns a pile
// of cards into a set of decisions.
//
// Nothing here touches Prisma. The shape and the scoring are pure so they can
// be tested without a database, and so the client can validate a swap before
// asking the server to make it.

import type { CardTier } from '@prisma/client';

/** A position a card can be. */
export type RosterPosition = 'QB' | 'RB' | 'WR' | 'TE';

export interface RosterSlotDef {
  /** Stable id, stored in the database. */
  id: string;
  /** What the slot is called on screen. Several slots share a label. */
  label: string;
  /** Positions eligible for this slot. */
  accepts: readonly RosterPosition[];
}

/** Positions a FLEX will take — everything but quarterbacks. */
export const FLEX_POSITIONS = ['RB', 'WR', 'TE'] as const;

/**
 * The lineup, in display order.
 *
 * Nine slots: QB, two RB, two WR, TE, three FLEX. The kicker and defense slots
 * that used to sit at the end went when those positions stopped being cards —
 * a third FLEX took their place rather than shrinking the lineup to seven,
 * which keeps a roster a real set of choices instead of a formality.
 *
 * Changing the lineup means editing this array and nothing else — slots are
 * stored one row each, keyed by the ids below, so adding or removing one needs
 * no migration.
 */
export const ROSTER_SLOTS: readonly RosterSlotDef[] = [
  { id: 'QB',    label: 'QB',   accepts: ['QB'] },
  { id: 'RB1',   label: 'RB',   accepts: ['RB'] },
  { id: 'RB2',   label: 'RB',   accepts: ['RB'] },
  { id: 'WR1',   label: 'WR',   accepts: ['WR'] },
  { id: 'WR2',   label: 'WR',   accepts: ['WR'] },
  { id: 'TE',    label: 'TE',   accepts: ['TE'] },
  { id: 'FLEX1', label: 'FLEX', accepts: FLEX_POSITIONS },
  { id: 'FLEX2', label: 'FLEX', accepts: FLEX_POSITIONS },
  { id: 'FLEX3', label: 'FLEX', accepts: FLEX_POSITIONS },
] as const;

/** How many cards a full lineup holds. */
export const ROSTER_SIZE = ROSTER_SLOTS.length;

/** Every slot id, for validating what a request asked for. */
export const ROSTER_SLOT_IDS: readonly string[] = ROSTER_SLOTS.map((s) => s.id);

/** The slot with this id, or null if there is no such slot. */
export function findSlot(slotId: string): RosterSlotDef | null {
  return ROSTER_SLOTS.find((s) => s.id === slotId) ?? null;
}

/**
 * Whether a card of `position` may start in `slotId`.
 *
 * The single source of truth for eligibility — the API guard and the UI's
 * "which of my cards can go here" filter both read it, so a slot cannot mean
 * one thing on the server and another in the picker.
 */
export function slotAccepts(slotId: string, position: string): boolean {
  const slot = findSlot(slotId);
  return slot ? (slot.accepts as readonly string[]).includes(position) : false;
}

/** The minimum a card needs for roster scoring. */
export interface RosterScorable {
  id: string;
  position: string;
  pointsPerGame: number;
  tier: CardTier;
}

/** A slot and whatever is in it. */
export interface FilledSlot {
  slot: RosterSlotDef;
  card: RosterScorable | null;
}

/**
 * Lays a set of slot assignments out in lineup order, including the empties.
 *
 * Returns all ten slots whether filled or not, because the UI draws an empty
 * slot as a thing you can click rather than as an absence.
 */
export function layoutRoster(
  assignments: Map<string, RosterScorable>,
): FilledSlot[] {
  return ROSTER_SLOTS.map((slot) => ({ slot, card: assignments.get(slot.id) ?? null }));
}

/**
 * What a lineup scores: the combined points per game of its starters.
 *
 * A sum rather than an average, because that is what a lineup means — the
 * points you would put up in a week if everyone played to their season average.
 * An average would make a one-man roster look identical to a full one.
 *
 * Empty slots simply contribute nothing, so a half-filled lineup scores half as
 * much and the incentive is to fill it.
 */
export function rosterPointsPerGame(cards: readonly RosterScorable[]): number {
  const total = cards.reduce((sum, card) => sum + card.pointsPerGame, 0);
  return Math.round(total * 10) / 10;
}

/**
 * The deck score: the average points per game across every card owned.
 *
 * Deliberately an average rather than a total, and deliberately over the whole
 * deck rather than the lineup. It answers a different question from the roster
 * score — not "how good is your best eleven" but "how good is everything you
 * pulled" — so a member who hoards good cards they cannot start still has a
 * number that reflects it.
 *
 * Zero for an empty deck rather than NaN.
 */
export function deckAveragePointsPerGame(cards: readonly { pointsPerGame: number }[]): number {
  if (!cards.length) return 0;
  const total = cards.reduce((sum, card) => sum + card.pointsPerGame, 0);
  return Math.round((total / cards.length) * 10) / 10;
}
