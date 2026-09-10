// tests/components/StatisticsTab.test.tsx
//
// Statistics is one of the two tabs a signed-out visitor may browse, so it is
// the one page where "who is looking?" changes what gets drawn. Player
// headshots are members-only; everything else on the tab — names, teams,
// positions, the numbers themselves — is public. These tests pin both halves
// of that, because a regression either way is silent: too much shows to
// strangers, or members quietly lose the pictures.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

import { StatisticsTab } from '@/components/dashboard/StatisticsTab';
import type { TrendingData } from '@/types/trending';

const originalFetch = global.fetch;

const HEADSHOT = 'https://static.www.nfl.com/image/private/headshot/bijan.png';

const trending: TrendingData = {
  adds:  [{ player_id: '1', name: 'Rico Dowdle',     type: 'add',  count: 100, position: 'RB', team: 'SF' }],
  drops: [{ player_id: '2', name: 'Zach Charbonnet', type: 'drop', count: 80,  position: 'RB', team: 'SEA' }],
};

// jsdom has no Response global, and the tab only reads `ok` and `json()`.
const reply = (body: unknown) => ({ ok: true, json: async () => body });

/** Stubs the two endpoints the leaderboard reads on mount. */
function stubApi() {
  global.fetch = jest.fn(async (url: unknown) =>
    String(url).includes('/api/nfl/seasons')
      ? reply([2025])
      : reply([{
          playerId: '10',
          playerDisplayName: 'Bijan Robinson',
          position: 'RB',
          team: 'ATL',
          headshot: HEADSHOT,
          statValue: 312.5,
          gamesPlayed: 17,
        }]),
  ) as unknown as typeof fetch;
}

function renderTab(isAuthed: boolean) {
  return render(
    <StatisticsTab
      trending={trending}
      trendingLoading={false}
      trendingError={null}
      onRetryTrending={() => {}}
      isAuthed={isAuthed}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  stubApi();
  // The ticker only re-measures through a ResizeObserver, which jsdom lacks.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

afterEach(() => { global.fetch = originalFetch; });

describe('<StatisticsTab />', () => {
  it('draws no headshot anywhere for a signed-out visitor', async () => {
    renderTab(false);

    // Wait for the leaderboard, so "no images" is a real absence rather than
    // the assertion landing before the fetch resolves.
    await screen.findByText('Bijan Robinson');
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('still gives a signed-out visitor the stats themselves', async () => {
    renderTab(false);

    expect(await screen.findByText('Bijan Robinson')).toBeInTheDocument();
    expect(screen.getByText('ATL')).toBeInTheDocument();
    expect(screen.getByText('17G')).toBeInTheDocument();
    // The ticker keeps its players too — only their pictures go.
    expect(screen.getByText('Rico Dowdle')).toBeInTheDocument();
  });

  it('shows the leaderboard headshot once signed in', async () => {
    renderTab(true);

    const img = await screen.findByAltText('Bijan Robinson');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toContain(encodeURIComponent(HEADSHOT));
  });

  it('shows the ticker headshot once signed in', async () => {
    renderTab(true);

    await waitFor(() => expect(screen.getByAltText('Rico Dowdle')).toBeInTheDocument());
  });
});
