// tests/components/CardsPage.test.tsx
//
// Covers the Packs page's chrome and its three tiles.
//
// This page is mostly other components, and they have their own tests — what
// is pinned here is the arrangement around them, because that is what the
// design asks for and what a stray refactor would quietly undo: the tabs are a
// row rather than a phone dropdown, the pack tile is the one that opens a pack,
// and the two readouts beside it open what they report rather than spelling it
// out in small print nobody reads.
//
// The heavy children are stubbed. Rendering a real PackOpener or DeckGrid here
// would test them a second time and make this suite fail for reasons that have
// nothing to do with the page.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CollectionResponse } from '@/types/cards';

const mockSession = jest.fn<() => { data: unknown; status: string }>();
jest.mock('next-auth/react', () => ({ useSession: () => mockSession() }));

// Stubs, each standing in for a panel with its own suite. Named so a failure
// here points at the page rather than at a component that is not on trial.
// The opener is stubbed down to the one thing the page cares about: the
// callback it fires when a pack has been dealt, which is what sends the page
// back to /collection. Everything else about it is PackOpener's own suite.
jest.mock('@/components/cards/PackOpener', () => ({
  PackOpener: ({ onDealt }: { onDealt: (result: unknown) => void }) => (
    <button type="button" onClick={() => onDealt({})}>deal-a-pack</button>
  ),
}));
jest.mock('@/components/cards/DeckGrid', () => ({ DeckGrid: () => <div>deck-grid</div> }));
jest.mock('@/components/cards/RosterPanel', () => ({ RosterPanel: () => <div>roster-panel</div> }));
jest.mock('@/components/cards/RankCard', () => ({ RankCard: () => <div>rank-card</div> }));
jest.mock('@/components/cards/Standings', () => ({ Standings: () => <div>standings</div> }));
jest.mock('@/components/cards/WeeklyPanel', () => ({ WeeklyPanel: () => <div>weekly-panel</div> }));
jest.mock('@/components/cards/WeekResults', () => ({ WeekResults: () => <div>week-results</div> }));
jest.mock('@/components/cards/CardDetail', () => ({ CardDetail: () => <div>card-detail</div> }));
jest.mock('@/components/cards/WildcardReveal', () => ({
  PendingWildcards: () => <div>pending-wildcards</div>,
}));
jest.mock('@/components/intro/DraftDeckIntro', () => ({
  DraftDeckIntro: () => <div>intro</div>,
  openDraftDeckIntro: () => {},
}));

import CardsPage from '@/app/league/cards/page';

const EMPTY_TIERS = { HALL_OF_FAME: 0, GOLD: 0, SILVER: 0, BRONZE: 0 };

function collection(over: Partial<CollectionResponse> = {}): CollectionResponse {
  return {
    allowance: {
      gameSeason: 2025, week: 1, granted: 3, opened: 0, remaining: 3,
      poolSize: 2000, claimed: 800, remainingCards: 1200, members: 3,
      perWeek: 2, rationStartsWeek: 2, pendingWildcards: [], nextPackTier: 'GOLD',
      bonusRemaining: 0, starterRemaining: 1, nextPackKind: 'STARTER',
      nextPackIsBonus: false,
    },
    stats: {
      cards: 5, byTier: EMPTY_TIERS, rosterPpg: 0, deckAvgPpg: 0, started: 0,
      rank: 1, players: 3, seasonPoints: 42.5, weeksPlayed: 1, retired: 0,
    },
    cards: [],
    roster: [],
    standings: [
      { userId: 'u1', name: 'Scott', rank: 1, cards: 5, rosterPpg: 0, deckAvgPpg: 0,
        started: 0, seasonPoints: 42.5, weeksPlayed: 1, byTier: EMPTY_TIERS, isYou: true },
    ],
    bonus: { kinds: [], awarded: [], week: null, threshold: 120 },
    weekly: {
      week: 1, phase: 'OPEN', lockAt: '', revealAt: '', lockLabel: '', revealLabel: '',
      seasonOver: false, submitted: null, revealedWeeks: [], retired: 0,
      seasonPoints: 42.5, weeksPlayed: 1,
    },
    seasons: [2024],
    ...over,
  };
}

async function renderPage(body: CollectionResponse = collection()) {
  mockSession.mockReturnValue({
    data: { user: { role: 'MEMBER' } }, status: 'authenticated',
  });
  global.fetch = jest.fn(async () => ({
    ok: true, status: 200, json: async () => body,
  })) as unknown as typeof fetch;

  render(<CardsPage />);
  // The tile itself, rather than the title or the "tap Draft Packs" line under
  // it: the title is drawn by the shell in every state including "Loading…",
  // so waiting on it waits for nothing.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Draft Packs/ })).toBeInTheDocument());
}

describe('Draft Deck page chrome', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  // WHY: the tabs are the page's navigation, and on a phone they were a
  //      dropdown that showed one of three. A row is what makes Deck and
  //      Lineup visible without a tap, so both bars have to render every tab.
  it('lays every tab out as a button, on both bars', async () => {
    await renderPage();

    for (const label of ['Packs', 'Deck', 'Lineup']) {
      // One button per bar — the phone's and the desktop's, each hidden at the
      // other's breakpoint.
      expect(screen.getAllByRole('button', { name: label })).toHaveLength(2);
    }
    // The dropdown the phone used to open, and the tab it used to hide.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // WHY: the back link is a phone's whole first line, and the sidebar already
  //      goes to the dashboard. It stays on a desktop, where there is room.
  it('keeps the dashboard link off a phone', async () => {
    await renderPage();

    const back = screen.getByRole('link', { name: /Dashboard/ });
    expect(back.className).toContain('hidden');
    expect(back.className).toContain('sm:block');
  });

  it('leads with the deck, not the collection', async () => {
    await renderPage();
    expect(screen.getByText('Build your deck. Win your legacy.')).toBeInTheDocument();
  });
});

describe('Draft Deck packs tiles', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  // WHY: the tile is the button the pack comes out of, and the rename is what
  //      says so. The ration line under it read as packs waiting to be opened
  //      right beneath the count of the ones that are.
  it('names the pack tile Draft Packs and drops the ration line', async () => {
    await renderPage();

    expect(screen.getByRole('button', { name: /Draft Packs/ })).toBeInTheDocument();
    expect(screen.queryByText('Packs left')).not.toBeInTheDocument();
    expect(screen.queryByText(/a week/)).not.toBeInTheDocument();
    // A starter pack in hand is a supply, not a rule — that hint stays.
    expect(screen.getByText('1 starter')).toBeInTheDocument();
  });

  // WHY: the banner explained a rule the tour already explains, on the tab
  //      where the packs themselves live.
  it('no longer carries the Sleeper bonus tile', async () => {
    await renderPage();
    expect(screen.queryByText('Sleeper bonus')).not.toBeInTheDocument();
  });

  // WHY: sub-issue #28 — the tile is the count alone, and what it used to say
  //      in an 8px hint line is behind a tap. The panel's own contents have
  //      their own suite; what is pinned here is the tile opening it.
  it('opens the pool behind the Cards left tile', async () => {
    await renderPage();

    // The hint line the tile carried: the pool size and the member count.
    expect(screen.getByText('Cards left')).toBeInTheDocument();
    expect(screen.queryByText(/of 2,000 · 3 members/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Cards left/ }));

    expect(screen.getByText(/of 2,000 cards left/)).toBeInTheDocument();
    expect(screen.getByText('Cards per player')).toBeInTheDocument();
  });
});

// ─── Re-reading after a pack ──────────────────────────────────────────────────
//
// The opener reports a pack the moment it is dealt — the cards are claimed
// server-side by then — and the page answers by re-reading the collection.
// That read now runs while a reveal is still on screen, which is what these
// cover: it must not be able to take the reveal down with it, and two of them
// racing must not leave the older one's pack count on the page.

/** Opens the pack dialog and deals a pack, firing the page's re-read. */
async function dealAPack() {
  await userEvent.click(screen.getByRole('button', { name: /Draft Packs/ }));
  await userEvent.click(screen.getByRole('button', { name: 'deal-a-pack' }));
}

describe('re-reading the collection after a pack', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  // WHY: issue #70's fix moved this read from the end of the reveal to the
  //      deal. A failed read used to replace the whole page with an error
  //      panel, which now unmounts the dialog and throws away a reveal the
  //      member is in the middle of — for cards the server has already given
  //      them. The deck stays, and the failure is a line above it.
  it('keeps the page up when the re-read fails', async () => {
    await renderPage();

    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await dealAPack();

    await waitFor(() => expect(screen.getByText(/offline/)).toBeInTheDocument());
    // Still the page, not the error panel: the tiles and the dialog survive.
    expect(screen.getByRole('button', { name: /Draft Packs/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'deal-a-pack' })).toBeInTheDocument();
    expect(screen.getByText(/your cards are safe/i)).toBeInTheDocument();
  });

  // WHY: two reads are in flight whenever a second pack is dealt before the
  //      first read lands, and responses are not ordered. The older one
  //      carries a pack count from before the newer pack was spent; letting it
  //      land hands the opener a pack that is gone, which the server then
  //      refuses.
  it('ignores a read that is overtaken by a newer one', async () => {
    await renderPage(collection({
      allowance: { ...collection().allowance, remaining: 3, starterRemaining: 0 },
    }));

    const bodies = [
      collection({ allowance: { ...collection().allowance, remaining: 2, starterRemaining: 0 } }),
      collection({ allowance: { ...collection().allowance, remaining: 1, starterRemaining: 0 } }),
    ];
    const settle: (() => void)[] = [];
    let next = 0;
    global.fetch = jest.fn(() => {
      const body = bodies[next++];
      return new Promise((resolve) => {
        settle.push(() => resolve({ ok: true, status: 200, json: async () => body }));
      });
    }) as unknown as typeof fetch;

    await dealAPack();
    await dealAPack();
    expect(settle).toHaveLength(2);

    // The newer read answers first, and the older one lands on top of it.
    settle[1]();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Draft Packs/ })).toHaveTextContent('1'));
    // Flushed inside `act`, so the assertion below runs after the stale
    // response has had every chance to be applied rather than merely before it.
    await act(async () => { settle[0](); });

    expect(screen.getByRole('button', { name: /Draft Packs/ })).toHaveTextContent('1');
  });
});
