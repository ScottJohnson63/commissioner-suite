// tests/components/RosterPanel.test.tsx
//
// Covers the lineup: ten rows, and the sheet you pick a card in.
//
// The rules worth pinning are the ones the row layout exists for. A row has to
// carry the player's name and PPG as text, because the 46px card chip beside it
// cannot — PlayerCard scales its own type off its width, so at chip size the
// name band is decoration and the row is the only legible copy. The picker has
// to open over the page from any row rather than under the one tapped, which is
// what stopped the options being pushed below the fold. And the chip and the
// row have to be two separate targets, since one opens the card and the other
// opens the picker.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RosterPanel } from '@/components/cards/RosterPanel';
import type { DeckStatsDto, OwnedCardDto, RosterSlotDto } from '@/types/cards';

function card(over: Partial<OwnedCardDto> = {}): OwnedCardDto {
  return {
    id: 'c1', season: 2003, playerId: 'p1', playerName: 'Jamal Lewis', position: 'RB',
    team: 'BAL', tier: 'GOLD', seasonRank: 7, fantasyPoints: 300, pointsPerGame: 18.8,
    gamesPlayed: 16, jerseyNumber: 31, headshot: null,
    nickname: null, customImage: null, eligibleForReward: true, isContributed: false,
    retiredWeek: null, retiredPoints: 0,
    ...over,
  };
}

const LEWIS = card();
const HOLMES = card({ id: 'c2', playerId: 'p2', playerName: 'Priest Holmes', pointsPerGame: 21.4 });
const RETIRED = card({ id: 'c3', playerId: 'p3', playerName: 'Ahman Green', retiredWeek: 4 });
const MANNING = card({
  id: 'c4', playerId: 'p4', playerName: 'Peyton Manning', position: 'QB', team: 'IND',
  pointsPerGame: 24.2,
});

const STATS: DeckStatsDto = {
  cards: 4, byTier: { HALL_OF_FAME: 0, GOLD: 4, SILVER: 0, BRONZE: 0 },
  rosterPpg: 18.8, deckAvgPpg: 20.1, started: 1, rank: 2, players: 4,
  seasonPoints: 0, weeksPlayed: 0, retired: 1,
};

function roster(over: Partial<Record<string, RosterSlotDto['card']>> = {}): RosterSlotDto[] {
  return [
    { id: 'QB',  label: 'QB',  accepts: ['QB'], card: over.QB ?? null },
    { id: 'RB1', label: 'RB',  accepts: ['RB'], card: 'RB1' in over ? over.RB1 ?? null : LEWIS },
    { id: 'FLEX', label: 'FLEX', accepts: ['RB', 'WR', 'TE'], card: over.FLEX ?? null },
  ];
}

let onAssign: jest.Mock<(...a: unknown[]) => Promise<void>>;

beforeEach(() => {
  onAssign = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
});

/** The row's own button — the one that opens the picker, not the card chip. */
function row(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^(Change|Fill) ${name}`) });
}

function panel(props: Partial<React.ComponentProps<typeof RosterPanel>> = {}) {
  return render(
    <RosterPanel
      roster={roster()}
      cards={[LEWIS, HOLMES, RETIRED, MANNING]}
      stats={STATS}
      onAssign={onAssign}
      busySlot={null}
      {...props}
    />,
  );
}

describe('RosterPanel', () => {
  // WHY: the chip is 46px and PlayerCard sizes its type off its width, so the
  //      card's own name band is unreadable there. If the row stops printing
  //      the name, the lineup stops naming anybody.
  it('names the starter and prints their PPG as text on the row', () => {
    panel();
    const rb = within(row('RB'));
    expect(rb.getByText('Jamal Lewis')).toBeInTheDocument();
    expect(rb.getByText('18.8')).toBeInTheDocument();
    expect(rb.getByText('BAL · RB · Gold')).toBeInTheDocument();
  });

  it('shows an empty slot as fillable, with what it takes', () => {
    panel();
    const flex = within(row('FLEX'));
    expect(flex.getByText('Empty')).toBeInTheDocument();
    expect(flex.getByText('RB · WR · TE')).toBeInTheDocument();
  });

  // WHY: the bug this row layout inherited. An owner who named a card and gave
  //      it a face saw the pool's name and the pool's portrait in their
  //      lineup — the customization rides on the slot's own card now (see
  //      LineupCardDto), so the deck is not consulted for it and an empty one
  //      here is the point of the test.
  it('shows the owner\'s nickname and portrait, without the deck', () => {
    const named = card({ nickname: 'The Bus', customImage: '/api/cards/image?cardId=c1&v=7' });
    panel({ roster: roster({ RB1: named }), cards: [] });

    const rb = within(row('RB'));
    expect(rb.getByText('The Bus')).toBeInTheDocument();
    expect(rb.queryByText('Jamal Lewis')).not.toBeInTheDocument();

    // The chip is the card itself, so the portrait is the owner's upload.
    expect(screen.getByAltText('The Bus')).toHaveAttribute(
      'src', '/api/cards/image?cardId=c1&v=7',
    );
  });

  // WHY: the whole point of the sheet. Opened from any row, it puts the slot
  //      and its candidates on screen together rather than under the row.
  it('opens the picker over the page with the slot named in it', async () => {
    panel();
    await userEvent.click(row('RB'));

    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByRole('button', { name: /^Start Priest Holmes — 21.4 PPG/ })).toBeInTheDocument();
    expect(sheet.getByText('2 eligible · best first')).toBeInTheDocument();
  });

  // WHY: a card plays one week a season. Offering a retired one and then
  //      refusing the click is a worse way to say so than not offering it.
  it('leaves retired cards and the wrong positions out of the picker', async () => {
    panel();
    await userEvent.click(row('RB'));

    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.queryByText('Ahman Green')).not.toBeInTheDocument();
    expect(sheet.queryByText('Peyton Manning')).not.toBeInTheDocument();
  });

  it('assigns the card that was picked', async () => {
    panel();
    await userEvent.click(row('RB'));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^Start Priest Holmes/ }),
    );

    expect(onAssign).toHaveBeenCalledWith('RB1', 'c2');
  });

  it('benches from the sheet, and only when the slot is filled', async () => {
    panel();

    await userEvent.click(row('QB'));
    expect(within(screen.getByRole('dialog')).queryByText('Bench')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(row('RB'));
    await userEvent.click(within(screen.getByRole('dialog')).getByText('Bench'));

    expect(onAssign).toHaveBeenCalledWith('RB1', null);
  });

  it('reports a rejected assignment instead of closing on it', async () => {
    onAssign.mockRejectedValue(new Error('That card already played in week 4'));
    panel();

    await userEvent.click(row('RB'));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^Start Priest Holmes/ }),
    );

    expect(await screen.findByText('That card already played in week 4')).toBeInTheDocument();
  });

  // WHY: the chip is the way to the full card, and it has to be a target of
  //      its own — tapping it must not open the picker instead.
  it('opens the full card from the chip, not the picker', async () => {
    const onInspect = jest.fn();
    panel({ onInspect });

    await userEvent.click(screen.getByRole('button', { name: "View Jamal Lewis's card" }));

    expect(onInspect).toHaveBeenCalledWith('c1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // WHY: without a handler there is nowhere for the chip to go, and a button
  //      that does nothing is worse than a picture.
  it('leaves the chip inert when nothing can be opened', () => {
    panel();
    expect(screen.queryByRole('button', { name: /View .*'s card/ })).not.toBeInTheDocument();
  });
});
