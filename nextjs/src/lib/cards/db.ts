// src/lib/cards/db.ts
//
// The two pieces of Prisma plumbing every card-game module needs, in one place
// so they cannot drift.
//
// Both were private to service.ts and are shared now that the weekly game reads
// the same cards and leans on the same uniqueness trick.

import { Prisma } from '@prisma/client';

/**
 * The card columns a client is ever shown. Keeps `builtAt` off the wire.
 *
 * One list rather than one per query: a card rendered in the deck, in a pack
 * and in a week's results is the same card, and a column missing from one of
 * those is a blank corner nobody notices until it ships.
 */
export const CARD_FIELDS = {
  id: true, season: true, playerId: true, playerName: true, position: true,
  team: true, tier: true, seasonRank: true, fantasyPoints: true,
  pointsPerGame: true, gamesPlayed: true, jerseyNumber: true, headshot: true,
} as const;

/** Prisma's error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Whether an error is a uniqueness violation, in either shape it arrives in.
 *
 * ⚠️ The libSQL driver adapter does not reliably translate SQLite's constraint
 * failure into Prisma's P2002. Under the adapter it comes back as a
 * `PrismaClientUnknownRequestError` carrying the raw `UNIQUE constraint failed`
 * text instead, so checking the code alone lets a genuine race escape as a 500
 * — which is exactly what happened the first time two members opened packs at
 * the same instant.
 *
 * Every uniqueness rule in this game is enforced by an index rather than by an
 * application check — exclusive card ownership, one Sleeper bonus a week, and
 * now one appearance per card per season — so anything that catches one of
 * those has to come through here.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === UNIQUE_VIOLATION;
  }
  // The message match is deliberately narrow: only the uniqueness failure
  // counts, so a foreign-key or NOT NULL error still propagates as the bug it
  // is.
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
