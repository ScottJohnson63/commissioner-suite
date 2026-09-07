// tests/components/TrendingTicker.test.tsx
//
// The ticker's one hard rule: a player is either shown whole or not at all.
// On a phone the row is barely wider than a single name, and the old fixed
// page size let the next player bleed off the edge — half an arrow, a sliver
// of a headshot. These tests fake the layout jsdom will not do for us and
// pin the behaviour at the widths where the cut-off used to happen.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, screen, act } from '@testing-library/react';

import { TrendingTicker } from '@/components/dashboard/TrendingTicker';
import type { TrendingPlayer } from '@/types/trending';

/** Width one player's row takes, in our fake layout. */
const ITEM = 120;

let resizeCallbacks: (() => void)[] = [];

beforeEach(() => {
  resizeCallbacks = [];
  // jsdom has no ResizeObserver; the component only re-measures through one.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(cb: () => void) { resizeCallbacks.push(cb); }
    observe() {}
    disconnect() {}
  };
});

function player(id: string, name: string, type: 'add' | 'drop'): TrendingPlayer {
  return { player_id: id, name, type, count: 100, position: 'RB', team: 'SF' };
}

/**
 * Give the row a width and lay its children out end to end, then let the
 * component re-measure. jsdom reports every rect as zero on its own, so
 * without this every player looks like it fits.
 */
function layout(rowWidth: number) {
  const row = document.querySelector('[data-ticker-row]') as HTMLElement;
  row.getBoundingClientRect = () =>
    ({ left: 0, right: rowWidth, width: rowWidth }) as DOMRect;

  [...row.children].forEach((kid, i) => {
    const left = i * ITEM;
    (kid as HTMLElement).getBoundingClientRect = () =>
      ({ left, right: left + ITEM, width: ITEM }) as DOMRect;
  });

  act(() => { resizeCallbacks.forEach((cb) => cb()); });
  return row;
}

/** Names of the players actually drawn (the hidden ones keep their box). */
function shown(row: HTMLElement): string[] {
  return [...row.children]
    .filter((kid) => (kid as HTMLElement).style.visibility !== 'hidden')
    .map((kid) => kid.querySelector('span.truncate')?.textContent ?? '');
}

const adds  = [player('1', 'Rico Dowdle', 'add'),  player('3', 'Jauan Jennings', 'add')];
const drops = [player('2', 'Zach Charbonnet', 'drop'), player('4', 'Cam Akers', 'drop')];

describe('TrendingTicker', () => {
  it('shows one player when only one fits', () => {
    render(<TrendingTicker adds={adds} drops={drops} loading={false} />);
    // 200px of room: the second player would end at 240 and be clipped.
    expect(shown(layout(200))).toEqual(['Rico Dowdle']);
  });

  it('shows two players when both fit whole', () => {
    render(<TrendingTicker adds={adds} drops={drops} loading={false} />);
    expect(shown(layout(240))).toEqual(['Rico Dowdle', 'Zach Charbonnet']);
  });

  it('never shows a player whose box crosses the right edge', () => {
    render(<TrendingTicker adds={adds} drops={drops} loading={false} />);
    // One pixel short of the second player's full width.
    const row = layout(239);
    expect(shown(row)).toEqual(['Rico Dowdle']);
    for (const kid of [...row.children].slice(1)) {
      expect((kid as HTMLElement).style.visibility).toBe('hidden');
    }
  });

  it('hides overflowing players from assistive tech too', () => {
    render(<TrendingTicker adds={adds} drops={drops} loading={false} />);
    const row = layout(200);
    expect(row.children[0].getAttribute('aria-hidden')).toBeNull();
    expect(row.children[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('cycles by however many players fit, so none are skipped', () => {
    jest.useFakeTimers();
    try {
      render(<TrendingTicker adds={adds} drops={drops} loading={false} />);
      const row = layout(200);
      expect(shown(row)).toEqual(['Rico Dowdle']);

      // 10s tick, then the 350ms fade-out before the page swaps.
      act(() => { jest.advanceTimersByTime(10_000); });
      act(() => { jest.advanceTimersByTime(350); });

      expect(shown(layout(200))).toEqual(['Zach Charbonnet']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders nothing but the label while loading', () => {
    render(<TrendingTicker adds={[]} drops={[]} loading />);
    expect(screen.getByText('Sleeper Trending')).toBeInTheDocument();
    expect(document.querySelector('[data-ticker-row]')).toBeNull();
  });
});
