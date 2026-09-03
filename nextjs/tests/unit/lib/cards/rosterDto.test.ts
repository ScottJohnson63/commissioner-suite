// tests/unit/lib/cards/rosterDto.test.ts
//
// Covers src/lib/cards/rosterDto.ts — the lineup's wire shape.
//
// The rule this file exists for is the join. `readRoster` reads CardDefinition,
// which is the pool's record of a player and knows nothing about who owns the
// card; a nickname and an uploaded portrait live on the ownership. Flattening
// the slot without joining them is what made the starting lineup the one screen
// in the game that showed a member the pool's name and the pool's face for a
// card they had renamed and photographed themselves.

import { describe, it, expect } from '@jest/globals';
import { toRosterDtos } from '@/lib/cards/rosterDto';
import type { FilledSlot } from '@/lib/cards/roster';
import type { OwnedCardDto } from '@/types/cards';

function owned(over: Partial<OwnedCardDto> = {}): OwnedCardDto {
  return {
    id: 'c1', season: 2003, playerId: 'p1', playerName: 'Jamal Lewis', position: 'RB',
    team: 'BAL', tier: 'GOLD', seasonRank: 7, fantasyPoints: 300, pointsPerGame: 18.8,
    gamesPlayed: 16, jerseyNumber: 31, headshot: null,
    nickname: null, customImage: null, eligibleForReward: true, isContributed: false,
    retiredWeek: null, retiredPoints: 0,
    ...over,
  };
}

/**
 * What readRoster hands over: the slot, and CardDefinition's copy of the card.
 *
 * Built by stripping the ownership fields off an OwnedCardDto rather than by
 * writing a second fixture, because the point of the test is that those fields
 * are absent here and present on the way out.
 */
function filled(card: OwnedCardDto): FilledSlot[] {
  const definition = {
    id: card.id, season: card.season, playerId: card.playerId,
    playerName: card.playerName, position: card.position, team: card.team,
    tier: card.tier, seasonRank: card.seasonRank, fantasyPoints: card.fantasyPoints,
    pointsPerGame: card.pointsPerGame, gamesPlayed: card.gamesPlayed,
    jerseyNumber: card.jerseyNumber, headshot: card.headshot,
  };

  return [
    { slot: { id: 'RB1', label: 'RB', accepts: ['RB'] }, card: definition },
    { slot: { id: 'QB', label: 'QB', accepts: ['QB'] }, card: null },
  ] as FilledSlot[];
}

describe('toRosterDtos()', () => {
  // WHY: the bug. Without the join the lineup renders CardDefinition, so a card
  //      its owner named "The Bus" and gave a photograph to came back as Jamal
  //      Lewis with the pool's portrait.
  it('carries the owner\'s nickname and portrait onto the slot', () => {
    const card = owned({ nickname: 'The Bus', customImage: '/api/cards/image?cardId=c1&v=7' });
    const [rb] = toRosterDtos(filled(card), [card]);

    expect(rb.card?.nickname).toBe('The Bus');
    expect(rb.card?.customImage).toBe('/api/cards/image?cardId=c1&v=7');
  });

  it('keeps the card itself intact', () => {
    const card = owned({ nickname: 'The Bus' });
    const [rb] = toRosterDtos(filled(card), [card]);

    expect(rb.card).toMatchObject({
      id: 'c1', playerName: 'Jamal Lewis', position: 'RB', tier: 'GOLD', pointsPerGame: 18.8,
    });
  });

  // WHY: a card with neither is the normal case, and it has to come back as
  //      null on both rather than as undefined — the UI falls back on `||`.
  it('is explicit about a card with no customization', () => {
    const card = owned();
    const [rb] = toRosterDtos(filled(card), [card]);

    expect(rb.card?.nickname).toBeNull();
    expect(rb.card?.customImage).toBeNull();
  });

  // WHY: both routes build this from one readDeck, so a slot card missing from
  //      the deck is already impossible. If it happens anyway, the lineup keeps
  //      the player rather than emptying the slot over a missing nickname.
  it('keeps a slot whose card is not in the deck', () => {
    const [rb] = toRosterDtos(filled(owned()), []);

    expect(rb.card?.playerName).toBe('Jamal Lewis');
    expect(rb.card?.nickname).toBeNull();
  });

  it('flattens the slot and leaves empty ones empty', () => {
    const dtos = toRosterDtos(filled(owned()), [owned()]);

    expect(dtos.map((s) => s.id)).toEqual(['RB1', 'QB']);
    expect(dtos[0]).toMatchObject({ label: 'RB', accepts: ['RB'] });
    expect(dtos[1].card).toBeNull();
  });
});
