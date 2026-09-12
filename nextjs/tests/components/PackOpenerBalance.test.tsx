// tests/components/PackOpenerBalance.test.tsx
//
// Pins what the opener does with a balance that runs out under it.
//
// The opener is handed `remaining` by the page, and the page only re-reads it
// once a pack has been revealed all the way to the end. So between spending the
// last pack and that re-read landing, the prop still says there is one left.
// Acting on it is issue #69: a member tore a pack they no longer had and the
// server answered "no packs left this week" — the UI had offered something that
// was not there.
//
// The fix is that the count in the open response wins over the prop, so these
// tests drive the opener with a stale prop on purpose and assert it believes
// the server instead.
//
// Also pins that "Open another" opens another. It did not: the click deferred
// to a timer that called the `start` captured mid-reveal, which refused to run
// because that closure's phase was not idle. The button was inert at every
// balance, which is why the lie above went unnoticed for so long.
//
// The pack is torn with the keyboard, as in PackOpener.test.tsx: jsdom has no
// pointer capture.

import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PackOpener } from '@/components/cards/PackOpener';
import type { CardTier, OpenPackResponse } from '@/types/cards';

function card(id: string, tier: CardTier) {
  return {
    id, season: 2025, playerId: id, playerName: `Player ${id}`, position: 'WR',
    team: 'SF', tier, seasonRank: 1, fantasyPoints: 170, pointsPerGame: 10,
    gamesPlayed: 17, jerseyNumber: 12, headshot: null,
    photoAuthor: null, photoLicense: null, photoLicenseUrl: null, photoFileUrl: null,
  };
}

/** A five-card ration pack, reporting `remaining` left once it is spent. */
function pack(remaining: number, wildcard: { id: string; week: number } | null = null): OpenPackResponse {
  return {
    packTier: 'SILVER',
    isBonus: false,
    packKind: 'RATION',
    cards: Array.from({ length: wildcard ? 4 : 5 }, (_, i) => card(String(i + 1), 'BRONZE')),
    newCardIds: [],
    wildcard,
    allowance: {
      gameSeason: 2026, week: 3, granted: 2, opened: 2 - remaining, remaining,
      poolSize: 1613, claimed: 0, remainingCards: 1613, members: 2, perWeek: 2,
      rationStartsWeek: 2, pendingWildcards: wildcard ? [wildcard] : [], nextPackTier: 'SILVER',
      bonusRemaining: 0, starterRemaining: 0,
      nextPackKind: 'RATION', nextPackIsBonus: false,
    },
  };
}

/** The single card in hand, whichever face it is showing. */
function inHand(): HTMLButtonElement | null {
  return screen.queryAllByRole('button').find((b) =>
    /click to turn it over|click for the next card|click to finish/i
      .test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement ?? null;
}

/**
 * Mounts the opener and tears the first pack.
 *
 * `remaining` is the page's count and stays fixed for the life of the test —
 * that staleness is the thing under test, so nothing here re-renders with a
 * fresher one.
 */
function mount(
  remaining: number,
  leftAfter: number,
  opts: { wildcard?: { id: string; week: number }; rolls?: number } = {},
) {
  const wildcard = opts.wildcard ?? null;
  const onOpen = jest.fn(
    async () => pack(leftAfter, wildcard),
  ) as jest.Mock<() => Promise<OpenPackResponse>>;
  render(
    <PackOpener
      remaining={remaining}
      nextPackTier="SILVER"
      nextPackKind="RATION"
      onOpen={onOpen as unknown as () => Promise<OpenPackResponse>}
      onRollWildcard={async (id) => ({
        id, rolled: true, value: opts.rolls ?? 4,
        packsGranted: 9, week: 3, gameSeason: 2026,
      })}
      onFinished={jest.fn()}
    />,
  );
  return onOpen;
}

async function tear(user: ReturnType<typeof userEvent.setup>) {
  const wrapper = screen.getByLabelText(/drag the top strip/i);
  wrapper.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(inHand()).not.toBeNull(), { timeout: 4000 });
}

/** Turns every card over, which is what brings up the summary. */
async function revealAll(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 12; i += 1) {
    const c = inHand();
    if (!c) break;
    await user.click(c);
  }
}

describe('the last pack', () => {
  it('refuses to offer another once the server says none are left', async () => {
    const user = userEvent.setup();
    const onOpen = mount(1, 0);

    await tear(user);
    await revealAll(user);

    const again = await screen.findByRole('button', { name: /open another|no packs left/i });
    expect(again).toHaveTextContent('No packs left');
    expect(again).toBeDisabled();

    await user.click(again);
    expect(onOpen.mock.calls.length).toBe(1);
  });

  it('does not re-seal a tearable pack after the spent one is dismissed', async () => {
    const user = userEvent.setup();
    const onOpen = mount(1, 0);

    await tear(user);
    await revealAll(user);
    await user.click(await screen.findByRole('button', { name: /^done$/i }));

    // Back at the idle pack, which must now read as empty rather than sealed —
    // the page has not re-read yet, so its `remaining` still says 1.
    const wrapper = await screen.findByLabelText(/no packs left this week/i);
    expect(wrapper).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/opened every pack this week/i)).toBeInTheDocument();

    wrapper.focus();
    await user.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 100));
    expect(onOpen.mock.calls.length).toBe(1);
  });
});

describe('with packs to spare', () => {
  it('opens another when asked', async () => {
    const user = userEvent.setup();
    const onOpen = mount(9, 8);

    await tear(user);
    await revealAll(user);

    const again = await screen.findByRole('button', { name: /open another/i });
    expect(again).toHaveTextContent('Open another (8)');
    expect(again).not.toBeDisabled();

    await user.click(again);
    await waitFor(() => expect(onOpen.mock.calls.length).toBe(2), { timeout: 4000 });
    // And the next pack is genuinely being revealed, not just requested.
    await waitFor(() => expect(inHand()).not.toBeNull(), { timeout: 4000 });
  });

  it('counts down from the server rather than the page between packs', async () => {
    const user = userEvent.setup();
    // The page says 2; the server says 1 is left after the pack it just dealt.
    mount(2, 1);

    await tear(user);
    await revealAll(user);
    await user.click(await screen.findByRole('button', { name: /^done$/i }));

    expect(await screen.findByText(/1 left this week/i)).toBeInTheDocument();
  });
});

describe('a wildcard thrown on the last pack', () => {
  // A die is the one thing that hands packs back while the opener is mounted.
  // The page re-reads after a roll, but a one thrown on a member's last pack
  // lands the page's count back on the number it already held — so the opener
  // has to credit the face itself rather than wait to be told.
  it('re-opens the pack it just won', async () => {
    const user = userEvent.setup();
    mount(1, 0, { wildcard: { id: 'w1', week: 3 }, rolls: 1 });

    await tear(user);

    // Two clicks a card — turn it over, move on — leaves the die in hand.
    for (let i = 0; i < 4; i += 1) {
      await user.click(inHand()!);
      await user.click(inHand()!);
    }
    await user.click(screen.getByLabelText(/face down/i));
    await user.click(screen.getByLabelText(/roll the wildcard die/i));
    await waitFor(() => expect(screen.getByText(/\+1 extra pack/i)).toBeInTheDocument(),
      { timeout: 4000 });

    // On to the summary: the pack the die just won is openable, without the
    // page having said a word.
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    const again = await screen.findByRole('button', { name: /open another|no packs left/i });
    expect(again).not.toBeDisabled();
  });
});
