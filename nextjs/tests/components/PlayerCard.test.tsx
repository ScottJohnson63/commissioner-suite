// tests/components/PlayerCard.test.tsx
//
// Pins the one promise the card face makes: it always shows something.
//
// Three quarters of the pool is illustrated from nfl.com or ESPN, a further
// slice from Wikimedia, and 800-odd players from the early 2000s have no
// photograph in any source anyone can reach. That last group is not a bug to
// be fixed but a state to be handled, and the handling is a chain — portrait,
// then team logo, then the team's letters. Each link is asserted here, because
// a broken one shows up as an empty rectangle in somebody's deck rather than
// as a failing build.

import { describe, it, expect } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';

import { PlayerCard, type PlayerCardData } from '@/components/cards/PlayerCard';

function card(over: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    id: 'c1', season: 2003, playerName: 'Eddie George', position: 'RB',
    team: 'TEN', tier: 'SILVER', seasonRank: 14, fantasyPoints: 200,
    pointsPerGame: 12.5, gamesPlayed: 16, jerseyNumber: 27, headshot: null,
    ...over,
  };
}

/** Every <img> the card rendered, by its resolved src. */
function sources(container: HTMLElement): string[] {
  return [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
}

describe('PlayerCard portrait', () => {
  // WHY: the ordinary case — a player with a photograph shows the photograph.
  it('shows the headshot when there is one', () => {
    const { container } = render(
      <PlayerCard card={card({ headshot: 'https://static.www.nfl.com/x.png' })} />,
    );
    expect(sources(container).some((s) => s.includes('static.www.nfl.com'))).toBe(true);
  });

  // WHY: this is the case the user actually hits. 800 players have no
  //      photograph anywhere, and every one of their cards must still render an
  //      image rather than an empty frame.
  it('falls back to the team logo when there is no headshot', () => {
    const { container } = render(<PlayerCard card={card({ headshot: null })} />);
    const srcs = sources(container);
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.some((s) => s.includes('espncdn.com/i/teamlogos/nfl/500/ten.png'))).toBe(true);
  });

  // WHY: a Wikimedia portrait is a normal portrait. It is a separate host from
  //      the other two, so it needs its own remotePattern in next.config.ts —
  //      and if that is ever dropped this is what catches it.
  it('renders a Wikimedia portrait like any other', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/e/e7/Jamal_Lewis.jpg';
    const { container } = render(<PlayerCard card={card({ headshot: url })} />);
    expect(sources(container).some((s) => s.includes('upload.wikimedia.org'))).toBe(true);
  });

  // WHY: a URL that 404s must degrade to the logo rather than leaving a broken
  //      image. This is the path that nfl.com's silhouette used to defeat, by
  //      answering 200 — so it is worth proving the handler still works.
  it('falls back to the team logo when the portrait fails to load', () => {
    const { container } = render(
      <PlayerCard card={card({ headshot: 'https://upload.wikimedia.org/gone.jpg' })} />,
    );
    const portrait = container.querySelector('img')!;
    fireEvent.error(portrait);
    expect(sources(container).some((s) => s.includes('teamlogos'))).toBe(true);
  });

  // WHY: the last link in the chain. No photograph and no team is the only
  //      state with no image to show, so it must still identify the card
  //      rather than rendering an empty frame. No card in the pool is in this
  //      state today, which is exactly why it needs a test rather than a look.
  it('falls back to lettering when there is neither photo nor team', () => {
    const { container } = render(<PlayerCard card={card({ headshot: null, team: null })} />);
    // Nothing left to load, so the frame must carry the position as text. The
    // position also appears in the stat line, hence getAllByText.
    expect(sources(container)).toHaveLength(0);
    expect(screen.getAllByText('RB').length).toBeGreaterThan(0);
  });

  // WHY: a logo that fails to load must not leave the frame empty either.
  it('falls back to lettering when the team logo fails to load', () => {
    const { container } = render(<PlayerCard card={card({ headshot: null })} />);
    fireEvent.error(container.querySelector('img')!);
    expect(sources(container)).toHaveLength(0);
    expect(screen.getAllByText('TEN').length).toBeGreaterThan(0);
  });
});
