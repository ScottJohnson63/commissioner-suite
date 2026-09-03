// src/app/api/cards/roster/route.ts
//
// PUT — put one of your cards in a lineup slot, or empty the slot.
//
// The lineup is what the standings rank on, so every rule about it is enforced
// here rather than trusted from the client: that the slot exists, that the
// member owns the card, and that the card's position is eligible. The picker in
// the UI filters by the same rule, but a filtered picker is a convenience and
// not a guard.
//
// One slot per request. A lineup change is a single decision and this keeps the
// failure modes small — a partial write of ten slots has no good answer.

import { NextRequest, NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireUser } from '@/lib/apiAuth';
import { gameSeason } from '@/lib/cards/allowance';
import { readDeck, setRosterSlot } from '@/lib/cards/service';
import { toRosterDtos } from '@/lib/cards/rosterDto';
import type { RosterUpdateResponse } from '@/types/cards';

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  let body: { slot?: unknown; cardId?: unknown };
  try {
    body = await req.json();
  } catch {
    return err('Body must be JSON: { "slot": "RB1", "cardId": "…" | null }', 400);
  }

  const slot = typeof body?.slot === 'string' ? body.slot : null;
  if (!slot) return err('A "slot" is required, e.g. { "slot": "RB1" }', 400);

  // null is meaningful — it empties the slot — so it is distinguished from
  // absent rather than folded together with it.
  const cardId =
    body.cardId === null ? null : typeof body.cardId === 'string' ? body.cardId : undefined;
  if (cardId === undefined) {
    return err('"cardId" must be a card id, or null to clear the slot', 400);
  }

  const season = gameSeason();

  try {
    const result = await setRosterSlot(guard.userId, season, slot, cardId);

    if (!result.ok) {
      switch (result.reason) {
        case 'UNKNOWN_SLOT':
          return err(`No such lineup slot: ${slot}`, 400);
        case 'NOT_OWNED':
          // 403 rather than 404: the card exists, it is just not theirs to play.
          return err('You do not own that card', 403);
        case 'WRONG_POSITION':
          return err('That player cannot start in that slot', 400);
        case 'RETIRED':
          // 409 rather than 403: the card is theirs, it has just been spent. A
          // card plays one week a season and is retired after it.
          return err('That card has already played — it is retired for the season', 409);
      }
    }

    // The whole lineup and the recomputed scores come back, so the page never
    // has to guess what a swap did to its ranking.
    const deck = await readDeck(guard.userId, season);
    const payload: RosterUpdateResponse = {
      roster: toRosterDtos(deck.roster, deck.cards),
      stats:  deck.stats,
    };
    return ok(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update lineup';
    return err(message, 500);
  }
}
