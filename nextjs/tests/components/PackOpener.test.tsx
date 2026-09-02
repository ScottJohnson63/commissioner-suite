// tests/components/PackOpener.test.tsx
//
// Pins the reveal: one card on screen, two clicks each.
//
// The card comes up face down in its tier's metal, the first click turns it
// over, and the second brings up the next one. That is easy to lose by
// accident — laying the pack out in a row, or adding a "reveal all" shortcut,
// would both look like improvements and would both give the best card away the
// moment the wrapper came off.
//
// Asserted for an ordinary pack as well as a ten-card bonus one, because the
// rule is not a property of bonus packs.
//
// The pack is torn with the keyboard: jsdom has no pointer capture, and Enter
// is a supported way in precisely so the drag is not the only route.

import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PackOpener } from '@/components/cards/PackOpener';
import type { CardTier, OpenPackResponse, PackKind, WildcardResponse } from '@/types/cards';

function card(id: string, tier: CardTier) {
  return {
    id, season: 2025, playerId: id, playerName: `Player ${id}`, position: 'WR',
    team: 'SF', tier, seasonRank: 1, fantasyPoints: 170, pointsPerGame: 10,
    gamesPlayed: 17, jerseyNumber: 12, headshot: null,
  };
}

function pack(
  size: number, kind: PackKind, wildcard: { id: string; week: number } | null = null,
): OpenPackResponse {
  const isBonus = kind === 'BONUS';
  return {
    packTier: 'SILVER',
    isBonus,
    packKind: kind,
    // A Gold in the middle, so the tier-coloured back has something to prove.
    cards: Array.from({ length: size }, (_, i) =>
      card(String(i + 1), i === 1 ? 'GOLD' : 'BRONZE')),
    newCardIds: [],
    wildcard,
    allowance: {
      gameSeason: 2026, week: 3, granted: 10, opened: 1, remaining: 9,
      poolSize: 1613, claimed: 0, remainingCards: 1613, members: 2, perWeek: 2,
      rationStartsWeek: 2,
      pendingWildcards: wildcard ? [wildcard] : [], nextPackTier: 'SILVER',
      bonusRemaining: isBonus ? 1 : 0,
      starterRemaining: kind === 'STARTER' ? size : 0,
      nextPackKind: kind, nextPackIsBonus: isBonus,
    },
  };
}

/** The single card in hand, whichever face it is showing. */
function inHand(): HTMLButtonElement | null {
  return screen.queryAllByRole('button').find((b) =>
    /click to turn it over|click for the next card|click to finish/i
      .test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement ?? null;
}

async function tearOpen(
  size: number,
  kind: PackKind,
  opts: {
    wildcard?: { id: string; week: number } | null;
    onRollWildcard?: (id: string) => Promise<WildcardResponse>;
  } = {},
) {
  const user = userEvent.setup();
  const wildcard = opts.wildcard ?? null;
  render(
    <PackOpener
      remaining={9}
      nextPackTier="SILVER"
      nextPackKind={kind}
      onOpen={async () => pack(size, kind, wildcard)}
      onRollWildcard={
        opts.onRollWildcard ??
        (async (id) => ({
          id, rolled: true, value: 4, packsGranted: 14, week: 3, gameSeason: 2026,
        }))
      }
      onFinished={jest.fn()}
    />,
  );

  const wrapper = screen.getByLabelText(/drag the top strip/i);
  wrapper.focus();
  await user.keyboard('{Enter}');

  await waitFor(() => expect(inHand()).not.toBeNull(), { timeout: 4000 });
  return user;
}

describe.each([
  ['an ordinary pack', 5, 'RATION'],
  ['a starter pack', 5, 'STARTER'],
  ['a bonus pack', 10, 'BONUS'],
])('%s reveals one card at a time', (_name, size, kind) => {
  it('shows a single card, face down', async () => {
    await tearOpen(size as number, kind as PackKind);

    const cards = screen.getAllByRole('button').filter((b) =>
      /click to turn it over|click for the next card/i.test(b.getAttribute('aria-label') ?? ''));

    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute('aria-label')).toMatch(/face down/i);
  });

  // WHY: the tease. The back carries the tier so a Gold announces itself before
  //      you know who it is — a neutral back would make the flip pointless.
  it('names the tier on the face-down card without naming the player', async () => {
    await tearOpen(size as number, kind as PackKind);

    const label = inHand()!.getAttribute('aria-label')!;
    expect(label).toMatch(/bronze card, face down/i);
    expect(label).not.toMatch(/player/i);
  });

  it('turns the card over on the first click, and advances on the second', async () => {
    const user = await tearOpen(size as number, kind as PackKind);

    await user.click(inHand()!);
    await waitFor(() =>
      expect(inHand()!.getAttribute('aria-label')).toMatch(/^Player 1, Bronze/i));

    await user.click(inHand()!);
    await waitFor(() =>
      // Card two is the Gold one, still face down.
      expect(inHand()!.getAttribute('aria-label')).toMatch(/gold card, face down/i));
  });

  it('never puts a second card on screen', async () => {
    const user = await tearOpen(size as number, kind as PackKind);

    for (let i = 0; i < 4; i++) {
      await user.click(inHand()!);
      await waitFor(() => {
        const onScreen = screen.getAllByRole('button').filter((b) =>
          /click to turn it over|click for the next card|click to finish/i
            .test(b.getAttribute('aria-label') ?? ''));
        expect(onScreen).toHaveLength(1);
      });
    }
  });

  // WHY: a shortcut makes the rule optional, which is the same as not having it.
  it('offers no way to reveal everything at once', async () => {
    await tearOpen(size as number, kind as PackKind);
    expect(screen.queryByText(/reveal all/i)).toBeNull();
  });
});

describe('finishing a pack', () => {
  it('lays the whole pack out only after the last card is dismissed', async () => {
    const user = await tearOpen(3, 'RATION');

    // Two clicks a card: turn, then advance. The final advance ends the pack.
    for (let i = 0; i < 6; i++) {
      const held = inHand();
      if (!held) break;
      await user.click(held);
      await waitFor(() => expect(true).toBe(true));
    }

    await waitFor(() => expect(screen.getByText(/open another/i)).toBeTruthy());
    expect(inHand()).toBeNull();
  });
});

// ─── The wildcard step ────────────────────────────────────────────────────────
//
// A wildcard displaces a card server-side, so the pack is still five steps —
// four players and a die. These cover the part the server cannot: that the die
// is reachable, that turning it over does not skip past it, and that a pack
// without one is unchanged.

describe('a pack carrying a wildcard', () => {
  /** Turns over every player card, leaving the wildcard as the step in hand. */
  async function advanceToWildcard(user: Awaited<ReturnType<typeof tearOpen>>, cards: number) {
    for (let i = 0; i < cards; i++) {
      await user.click(inHand()!);   // turn it over
      await user.click(inHand()!);   // move on
    }
  }

  it('offers a die once the wildcard is turned over', async () => {
    const user = await tearOpen(4, 'RATION', { wildcard: { id: 'wc1', week: 3 } });
    await advanceToWildcard(user, 4);

    // The wildcard arrives face down like any other card.
    const facedown = screen.getByLabelText(/face down/i);
    await user.click(facedown);

    expect(screen.getByLabelText(/roll the wildcard die/i)).toBeInTheDocument();
  });

  // WHY: the one click that could lose the thing you just found. Turning the
  //      wildcard over must not also advance past it.
  it('does not advance past the wildcard when it is turned over', async () => {
    const user = await tearOpen(4, 'RATION', { wildcard: { id: 'wc1', week: 3 } });
    await advanceToWildcard(user, 4);
    await user.click(screen.getByLabelText(/face down/i));

    // Still on the wildcard step: the die is there and the summary is not.
    expect(screen.getByLabelText(/roll the wildcard die/i)).toBeInTheDocument();
    expect(screen.queryByText(/open another/i)).not.toBeInTheDocument();
  });

  it('throws the die by id and shows what it won', async () => {
    const onRollWildcard = jest.fn(async (id: string) => ({
      id, rolled: true, value: 4, packsGranted: 14, week: 3, gameSeason: 2026,
    }));

    const user = await tearOpen(4, 'RATION', {
      wildcard: { id: 'wc1', week: 3 },
      onRollWildcard: onRollWildcard as unknown as (id: string) => Promise<WildcardResponse>,
    });
    await advanceToWildcard(user, 4);
    await user.click(screen.getByLabelText(/face down/i));
    await user.click(screen.getByLabelText(/roll the wildcard die/i));

    await waitFor(() => expect(screen.getByText(/\+4 extra packs/i)).toBeInTheDocument(),
      { timeout: 4000 });
    expect(onRollWildcard).toHaveBeenCalledWith('wc1');
  });

  // WHY: the server refuses a second throw, but the button must not offer one
  //      either — a die that visibly re-rolls is a die nobody trusts.
  it('will not throw the same die twice', async () => {
    const onRollWildcard = jest.fn(async (id: string) => ({
      id, rolled: true, value: 4, packsGranted: 14, week: 3, gameSeason: 2026,
    }));

    const user = await tearOpen(4, 'RATION', {
      wildcard: { id: 'wc1', week: 3 },
      onRollWildcard: onRollWildcard as unknown as (id: string) => Promise<WildcardResponse>,
    });
    await advanceToWildcard(user, 4);
    await user.click(screen.getByLabelText(/face down/i));

    const die = screen.getByLabelText(/roll the wildcard die/i);
    await user.click(die);
    await waitFor(() => expect(screen.getByText(/\+4 extra packs/i)).toBeInTheDocument(),
      { timeout: 4000 });
    await user.click(screen.getByLabelText(/rolled 4/i));

    expect(onRollWildcard).toHaveBeenCalledTimes(1);
  });

  // WHY: gating the way out on a successful roll trapped the reveal — a die
  //      whose request failed left no way forward but a page reload. The
  //      wildcard is owned server-side already, so leaving loses nothing.
  it('can be left unthrown when the roll fails', async () => {
    const user = await tearOpen(4, 'RATION', {
      wildcard: { id: 'wc1', week: 3 },
      onRollWildcard: async () => { throw new Error('network is down'); },
    });
    await advanceToWildcard(user, 4);
    await user.click(screen.getByLabelText(/face down/i));
    await user.click(screen.getByLabelText(/roll the wildcard die/i));

    await waitFor(() => expect(screen.getByText(/network is down/i)).toBeInTheDocument(),
      { timeout: 4000 });

    // The way out is still there, and it finishes the pack.
    await user.click(screen.getByText(/throw it later/i));
    expect(screen.queryByLabelText(/roll the wildcard die/i)).not.toBeInTheDocument();
  });

  it('leaves a pack without one exactly as it was', async () => {
    const user = await tearOpen(5, 'RATION');
    for (let i = 0; i < 5; i++) {
      await user.click(inHand()!);
      if (i < 4) await user.click(inHand()!);
    }
    await user.click(inHand()!);

    expect(screen.queryByLabelText(/wildcard/i)).not.toBeInTheDocument();
  });
});
