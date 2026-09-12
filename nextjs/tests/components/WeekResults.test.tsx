// tests/components/WeekResults.test.tsx
//
// Covers the reveal's two homes and the one thing that differs between them.
//
// The panel on the lineup tab picks a week from a row of buttons; the dialog
// behind the Packs page's Season tile picks one from a dropdown, because a
// dialog is phone-wide and a row of buttons grows one every week. Both are the
// same panel and both have to report the same week back to the page, which is
// what these pin — a picker that renders but never calls `onWeek` leaves a
// member looking at week 1 with no way back to today.

import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WeekResults } from '@/components/cards/WeekResults';
import type { PlayedCardDto, WeekResultsDto } from '@/types/cards';

function playedCard(over: Partial<PlayedCardDto> = {}): PlayedCardDto {
  return {
    id: 'c1', season: 2003, playerId: 'p1', playerName: 'Priest Holmes', position: 'RB',
    team: 'KC', tier: 'GOLD', seasonRank: 2, fantasyPoints: 340, pointsPerGame: 22.7,
    gamesPlayed: 15, jerseyNumber: 31, headshot: null,
    photoAuthor: null, photoLicense: null, photoLicenseUrl: null, photoFileUrl: null,
    nickname: null, customImage: null, slot: 'RB1', points: 22.7,
    ownerId: 'u1', ownerName: 'Scott', isYou: true,
    ...over,
  };
}

function results(over: Partial<WeekResultsDto> = {}): WeekResultsDto {
  return {
    gameSeason: 2025,
    week: 3,
    revealedAt: '2025-09-23T15:00:00.000Z',
    weeks: [1, 2, 3],
    entries: [
      { userId: 'u1', name: 'Scott', isYou: true, rank: 1, points: 118.4, filled: 11,
        submittedAt: '2025-09-21T12:00:00.000Z', cards: [playedCard()] },
      { userId: 'u2', name: 'Dana', isYou: false, rank: 2, points: 101.2, filled: 10,
        submittedAt: '2025-09-21T13:00:00.000Z', cards: [] },
    ],
    cards: [playedCard()],
    ...over,
  };
}

describe('WeekResults week picker', () => {
  // WHY: the lineup tab's picker. Eighteen weeks laid out as buttons is how a
  //      member sees the season's length without opening anything, so the
  //      default variant must stay a row of buttons rather than a dropdown.
  it('picks a week from a row of buttons in the panel variant', async () => {
    const onWeek = jest.fn();
    render(
      <WeekResults results={results()} week={3} onWeek={onWeek} loading={false} />,
    );

    expect(screen.queryByLabelText('Week')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onWeek).toHaveBeenCalledWith(1);
  });

  // WHY: issue #27 — the Season tile's dialog filters previous weeks from a
  //      dropdown. The select has to be controlled by the page's week, not by
  //      itself, or closing and reopening the dialog would show one week and
  //      say another.
  it('picks a week from a dropdown in the dialog variant', async () => {
    const onWeek = jest.fn();
    render(
      <WeekResults
        results={results()} week={3} onWeek={onWeek} loading={false} variant="dialog"
      />,
    );

    const select = screen.getByLabelText('Week') as HTMLSelectElement;
    expect(select.value).toBe('3');
    // Newest first: the week you came to read is the option already on top.
    expect([...select.options].map((o) => o.textContent))
      .toEqual(['Week 3', 'Week 2', 'Week 1']);

    await userEvent.selectOptions(select, '2');
    expect(onWeek).toHaveBeenCalledWith(2);
  });

  // WHY: the dialog opens before its first fetch settles, and a select whose
  //      value matches no option is an uncontrolled select — React warns and
  //      the browser silently shows the first week instead of none.
  it('offers a placeholder option while no week is selected', () => {
    render(
      <WeekResults
        results={results()} week={null} onWeek={jest.fn()} loading variant="dialog"
      />,
    );

    expect((screen.getByLabelText('Week') as HTMLSelectElement).value).toBe('');
  });

  // WHY: a member who opens the Season tile in week 1 has nothing published
  //      yet. They should be told when the first reveal lands rather than
  //      shown an empty dropdown to fiddle with.
  it('says when the first week publishes instead of drawing an empty picker', () => {
    const empty: WeekResultsDto = results({ week: 0, weeks: [], entries: [], cards: [] });
    render(
      <WeekResults
        results={empty} week={null} onWeek={jest.fn()} loading={false} variant="dialog"
      />,
    );

    expect(screen.queryByLabelText('Week')).not.toBeInTheDocument();
    expect(screen.getByText(/No results yet/)).toBeInTheDocument();
  });
});
