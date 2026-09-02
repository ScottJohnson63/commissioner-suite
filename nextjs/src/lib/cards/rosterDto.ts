// src/lib/cards/rosterDto.ts
//
// Flattening a roster slot for the wire.
//
// `FilledSlot` nests the slot definition inside itself, which is convenient for
// the scoring functions and awkward for a client — so the shape is flattened
// once, here, rather than in each of the two routes that return a lineup.
//
// It also joins the owner's nickname and portrait onto the card, which is the
// other half of the job and the half that was missing. `readRoster` reads
// `CardDefinition` — the pool's record of a player — and a nickname and an
// uploaded picture live on the ownership instead. A lineup built from the
// definition alone showed a member the pool's name and the pool's face for a
// card they had named and photographed themselves, everywhere the lineup is
// drawn.
//
// The join is done from the deck the caller already read rather than from a
// query of its own: both routes that return a lineup return that deck in the
// same response, so the customization is in hand and a second read would only
// be a chance for the two to disagree.

import type { FilledSlot } from '@/lib/cards/roster';
import type { CardDto, LineupCardDto, OwnedCardDto, RosterSlotDto } from '@/types/cards';

/**
 * A member's lineup on the wire, with each card as its owner customized it.
 *
 * @param roster The slots, filled or empty, in lineup order.
 * @param owned  That member's deck — the source of the nicknames and portraits.
 *               A slot card missing from it keeps the pool's name and face
 *               rather than dropping out of the lineup: the two come from one
 *               `readDeck`, so that should not happen, and a lineup is the
 *               wrong place to discover that it did.
 */
export function toRosterDtos(
  roster: readonly FilledSlot[],
  owned: readonly OwnedCardDto[],
): RosterSlotDto[] {
  const byId = new Map(owned.map((card) => [card.id, card]));

  return roster.map((filled) => ({
    id:      filled.slot.id,
    label:   filled.slot.label,
    accepts: filled.slot.accepts,
    card:    filled.card ? customized(filled.card as CardDto, byId) : null,
  }));
}

function customized(
  card: CardDto,
  byId: ReadonlyMap<string, OwnedCardDto>,
): LineupCardDto {
  const mine = byId.get(card.id);
  return {
    ...card,
    nickname:    mine?.nickname ?? null,
    customImage: mine?.customImage ?? null,
  };
}
