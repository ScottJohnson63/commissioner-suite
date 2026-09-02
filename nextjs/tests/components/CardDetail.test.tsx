// tests/components/CardDetail.test.tsx
//
// Covers the deck's detail panel — the one place a card can be named, given a
// face, or put in the lineup.
//
// The rules worth pinning are the ones a user would notice going wrong: Save
// must stay disabled until something has actually changed (it posts, and a
// no-op post that reported "saved" would be a lie), the lineup buttons must
// offer only slots the card is eligible for, and a completed card must say
// what it earned.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CardDetail } from '@/components/cards/CardDetail';
import type { CustomizeResponse, OwnedCardDto, RosterSlotDto } from '@/types/cards';

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

const ROSTER: RosterSlotDto[] = [
  { id: 'QB',   label: 'QB',   accepts: ['QB'],             card: null },
  { id: 'RB1',  label: 'RB',   accepts: ['RB'],             card: null },
  { id: 'FLEX', label: 'FLEX', accepts: ['RB', 'WR', 'TE'], card: null },
];

const SAVED: CustomizeResponse = {
  cardId: 'c1', nickname: 'The Bus', hasCustomImage: false, isContributed: false,
  eligibleForReward: true, packsAwarded: 0, packsEarnedTotal: 0, rewardsRemaining: 15,
};

let onSave: jest.Mock<(...a: unknown[]) => Promise<CustomizeResponse>>;
let onAssign: jest.Mock<(...a: unknown[]) => Promise<void>>;

beforeEach(() => {
  onSave = jest.fn<(...a: unknown[]) => Promise<CustomizeResponse>>().mockResolvedValue(SAVED);
  onAssign = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
});

function panel(over: Partial<OwnedCardDto> = {}, rewardsRemaining = 15) {
  return render(
    <CardDetail
      card={card(over)} roster={ROSTER} onSave={onSave} onAssign={onAssign}
      busySlot={null} rewardsRemaining={rewardsRemaining}
    />,
  );
}

describe('CardDetail', () => {
  it('prompts when nothing is selected', () => {
    render(
      <CardDetail card={null} roster={ROSTER} onSave={onSave} onAssign={onAssign}
                  busySlot={null} rewardsRemaining={15} />,
    );
    expect(screen.getByText(/Pick a card below/)).toBeInTheDocument();
  });

  // WHY: Save posts. Leaving it live on an untouched card means a stray click
  //      writes nothing and reports success, which teaches the button lies.
  it('disables Save until something changes', async () => {
    panel();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Nickname'), 'The Bus');
    expect(save).toBeEnabled();
  });

  it('sends the nickname on save', async () => {
    panel();
    await userEvent.type(screen.getByLabelText('Nickname'), 'The Bus');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('c1', 'The Bus', null));
  });

  // WHY: the reward is the whole point of the feature, so the moment it is
  //      paid has to be visible — and so must the fact that the portrait is
  //      permanent, which is the part that makes it worth doing.
  it('reports the pack a contributed portrait earned, and that it is permanent', async () => {
    onSave.mockResolvedValue({
      ...SAVED, hasCustomImage: true, isContributed: true, packsAwarded: 1,
    });
    panel();
    await userEvent.type(screen.getByLabelText('Nickname'), 'The Bus');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    // The fuller phrase, because the upload hint also says "permanently".
    expect(await screen.findByText(/1 pack earned[\s\S]*stays with the card/)).toBeInTheDocument();
  });

  // WHY: a nickname alone earns nothing now — the picture is the whole reward.
  //      Saying what is missing is what tells a member it is worth doing.
  it('says a picture is what earns the pack', async () => {
    panel();
    await userEvent.type(screen.getByLabelText('Nickname'), 'The Bus');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Upload a picture for this card to earn a pack/))
      .toBeInTheDocument();
  });

  // WHY: the restraint, stated where a member will read it before uploading.
  //      Finding out afterwards that a replacement earned nothing and will be
  //      wiped at the reset is the bad version of this.
  it('warns that replacing an existing photo earns nothing and resets', () => {
    panel({ eligibleForReward: false, headshot: 'https://x/y.png' });
    expect(screen.getByText(/earns no pack and resets/)).toBeInTheDocument();
  });

  // WHY: the opposite case — a faceless card should advertise what it is worth.
  it('says a faceless card is worth a pack', () => {
    panel({ eligibleForReward: true });
    expect(screen.getByText(/No photo exists — upload one for a pack/)).toBeInTheDocument();
  });

  // WHY: a contributed portrait outliving the reset is the promise made when
  //      the pack was paid, so the card has to keep saying so.
  it('says a contributed portrait is kept after the reset', () => {
    panel({ isContributed: true, customImage: '/api/cards/image?cardId=c1&v=1' });
    expect(screen.getByText(/kept after the season resets/)).toBeInTheDocument();
  });

  // WHY: the picker must match the rule the route enforces. Offering a slot
  //      that will be refused turns a server guard into a broken button.
  it('offers only slots the card is eligible for', () => {
    panel();
    expect(screen.getByRole('button', { name: /^RB/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^FLEX/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^QB/ })).not.toBeInTheDocument();
  });

  it('assigns the card to a slot', async () => {
    panel();
    await userEvent.click(screen.getByRole('button', { name: /^FLEX/ }));
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith('FLEX', 'c1'));
  });

  // WHY: a started card needs a way back out, and it must not also offer to
  //      start somewhere it already is.
  it('offers to bench a card that is already starting', async () => {
    render(
      <CardDetail
        card={card()} roster={[{ ...ROSTER[1], card: card() }, ROSTER[2]]}
        onSave={onSave} onAssign={onAssign} busySlot={null} rewardsRemaining={15}
      />,
    );
    expect(screen.getByText(/Starting at RB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bench' }));
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith('RB1', null));
  });

  // WHY: the cap is a pool-safety limit, so a member at it should find out
  //      before they customize twenty more cards expecting packs.
  it('says when the season pack rewards are used up', () => {
    panel({ eligibleForReward: true }, 0);
    expect(screen.getByText(/Pack rewards used up/)).toBeInTheDocument();
  });

  // WHY: the nickname replaces the name on the face, so the real name has to
  //      survive somewhere or the card stops being identifiable.
  it('keeps the real name visible under a nicknamed card', () => {
    panel({ nickname: 'The Bus' });
    expect(screen.getByText(/Jamal Lewis/)).toBeInTheDocument();
  });
});
