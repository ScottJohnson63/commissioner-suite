// tests/components/CardsLeftPanel.test.tsx
//
// Covers what the "Cards left" tile hands off to.
//
// Two rules are worth pinning. The headline has to say the count *out of* the
// pool, because the tile itself now shows the bare number and this is the only
// place the denominator appears. And the per-member list has to be ranked by
// cards held, not by the season points the standings arrive sorted by — it is
// the same rows under a different sort, which is exactly the kind of thing a
// later refactor drops on the floor.

import { describe, it, expect } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';

import { CardsLeftPanel } from '@/components/cards/CardsLeftPanel';
import type { LeaderboardEntryDto } from '@/types/cards';

function entry(over: Partial<LeaderboardEntryDto> = {}): LeaderboardEntryDto {
  return {
    userId: 'u1', name: 'Ada', rank: 1, cards: 0, rosterPpg: 0, deckAvgPpg: 0,
    started: 0, seasonPoints: 0, weeksPlayed: 0, isYou: false,
    byTier: { HALL_OF_FAME: 0, GOLD: 0, SILVER: 0, BRONZE: 0 },
    ...over,
  };
}

// Ranked by season points, which is the order the page holds them in — and
// deliberately the reverse of the card counts, so a panel that just rendered
// the array as given would fail.
const ENTRIES = [
  entry({ userId: 'u1', name: 'Ada', seasonPoints: 90, cards: 4 }),
  entry({ userId: 'u2', name: 'Grace', seasonPoints: 60, cards: 11, isYou: true }),
  entry({ userId: 'u3', name: 'Linus', seasonPoints: 30, cards: 7 }),
];

function renderPanel(over: Partial<React.ComponentProps<typeof CardsLeftPanel>> = {}) {
  return render(
    <CardsLeftPanel
      remainingCards={78}
      poolSize={100}
      claimed={22}
      members={3}
      entries={ENTRIES}
      {...over}
    />,
  );
}

describe('CardsLeftPanel', () => {
  it('states the cards left out of the whole pool', () => {
    renderPanel();
    expect(screen.getByText('78')).toBeInTheDocument();
    expect(screen.getByText('of 100 cards left')).toBeInTheDocument();
  });

  it('says how much has been claimed and how many are playing', () => {
    renderPanel();
    expect(screen.getByText(/22 claimed/)).toBeInTheDocument();
    expect(screen.getByText(/3 members playing/)).toBeInTheDocument();
  });

  it('lists every member by cards held, most first', () => {
    renderPanel();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByText(/Ada|Grace|Linus/).textContent))
      .toEqual(['Graceyou', 'Linus', 'Ada']);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('11'),
      expect.stringContaining('7'),
      expect.stringContaining('4'),
    ]);
  });

  it('holds a stable order when nobody has opened anything', () => {
    renderPanel({
      remainingCards: 100, claimed: 0,
      entries: [
        entry({ userId: 'u3', name: 'Linus' }),
        entry({ userId: 'u1', name: 'Ada' }),
        entry({ userId: 'u2', name: 'Grace' }),
      ],
    });
    expect(screen.getAllByRole('listitem').map((row) => row.textContent?.replace(/\d/g, '').trim()))
      .toEqual(['Ada', 'Grace', 'Linus']);
  });

  it('says so rather than showing an empty table with no members', () => {
    renderPanel({ entries: [] });
    expect(screen.getByText('Nobody is in the league yet.')).toBeInTheDocument();
  });

  it('survives an empty pool without dividing by zero', () => {
    renderPanel({ remainingCards: 0, poolSize: 0, claimed: 0, entries: [] });
    expect(screen.getByText('of 0 cards left')).toBeInTheDocument();
  });
});
