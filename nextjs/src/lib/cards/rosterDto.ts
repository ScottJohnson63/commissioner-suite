// src/lib/cards/rosterDto.ts
//
// Flattening a roster slot for the wire.
//
// `FilledSlot` nests the slot definition inside itself, which is convenient for
// the scoring functions and awkward for a client — so the shape is flattened
// once, here, rather than in each of the two routes that return a lineup.

import type { FilledSlot } from '@/lib/cards/roster';
import type { CardDto, RosterSlotDto } from '@/types/cards';

export function toRosterDto(filled: FilledSlot): RosterSlotDto {
  return {
    id:      filled.slot.id,
    label:   filled.slot.label,
    accepts: filled.slot.accepts,
    card:    (filled.card as CardDto | null) ?? null,
  };
}
