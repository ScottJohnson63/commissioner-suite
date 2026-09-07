// tests/components/CardsLeftPanel.test.tsx
//
// Covers what the Cards left tile opens.
//
// The tile is a bare number now, so everything that number means lives in this
// panel: what it is out of, and whose decks the rest of the pool went into.
// Two things are worth pinning — that the pool line reads as a fraction rather
// than a lone count, and that the per-member list runs most cards to least. A
// list in the standings' own order looks sorted and is not, which is the bug
// nobody would spot by eye.

import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { CardsLeftPanel } from '@/components/cards/CardsLeftPanel';
import type { AllowanceDto, LeaderboardEntryDto } from '@/types/cards';

function allowance(over: Partial<AllowanceDto> = {}): AllowanceDto {
  return {
    gameSeason: 2025, week: 3, granted: 2, opened: 1, remaining: 1,
    poolSize: 2000, claimed: 800, remainingCards: 1200, members: 3,
    perWeek: 2, rationStartsWeek: 2, pendingWildcards: [], nextPackTier: 'GOLD',
    bonusRemaining: 0, starterRemaining: 0, nextPackKind: 'RATION',
    nextPackIsBonus: false,
    ...over,
  };
}

const EMPTY_TIERS = { HALL_OF_FAME: 0, GOLD: 0, SILVER: 0, BRONZE: 0 };

function entry(over: Partial<LeaderboardEntryDto> = {}): LeaderboardEntryDto {
  return {
    userId: 'u1', name: 'Scott', rank: 1, cards: 10, rosterPpg: 0, deckAvgPpg: 0,
    started: 0, seasonPoints: 0, weeksPlayed: 0, byTier: EMPTY_TIERS, isYou: false,
    ...over,
  };
}

describe('CardsLeftPanel', () => {
  // WHY: the count on its own says nothing about how close the pool is to dry,
  //      and the pool running dry is the game's end state.
  it('reads the count against the pool it came out of', () => {
    render(<CardsLeftPanel allowance={allowance()} standings={[entry()]} />);

    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText(/of 2,000 cards still unclaimed/)).toBeInTheDocument();
    expect(screen.getByText(/800 claimed · 40% of the pool/)).toBeInTheDocument();
  });

  // WHY: the whole point of the list. The standings arrive ranked on season
  //      points, which is a different order — sorting has to happen here.
  it('lists players by cards held, most to least', () => {
    render(
      <CardsLeftPanel
        allowance={allowance()}
        standings={[
          entry({ userId: 'u1', name: 'Scott', rank: 1, cards: 4 }),
          entry({ userId: 'u2', name: 'Dana', rank: 2, cards: 31, isYou: true }),
          entry({ userId: 'u3', name: 'Ray', rank: 3, cards: 12 }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['Dana31', 'Ray12', 'Scott4']);
  });

  // WHY: a member who has never opened a pack is still in the league, and the
  //      standings include them on zero. Dropping them would make the list
  //      disagree with the standings on who is playing.
  it('keeps players on zero, in name order behind the rest', () => {
    render(
      <CardsLeftPanel
        allowance={allowance()}
        standings={[
          entry({ userId: 'u1', name: 'Zoe', cards: 0 }),
          entry({ userId: 'u2', name: 'Dana', cards: 0 }),
          entry({ userId: 'u3', name: 'Ray', cards: 3 }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['Ray3', 'Dana0', 'Zoe0']);
  });

  // WHY: an empty pool is a real state — a league whose commissioner has not
  //      built the cards yet — and the claimed share is a divide.
  it('survives an empty pool', () => {
    render(
      <CardsLeftPanel
        allowance={allowance({ poolSize: 0, claimed: 0, remainingCards: 0 })}
        standings={[]}
      />,
    );

    expect(screen.getByText(/0 claimed · 0% of the pool/)).toBeInTheDocument();
    expect(screen.getByText('Nobody is playing yet.')).toBeInTheDocument();
  });
});
