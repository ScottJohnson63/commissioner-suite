// tests/components/leagueNav.test.tsx
//
// Who sees which destination in the portal nav.
//
// This is the one list both navs read — the desktop rail and the phone's
// floating hamburger — so a mistake here is not a cosmetic one: it either hides
// a page from somebody entitled to it or advertises one they cannot use.
//
// Commissioner is the entry these tests exist for. The schedule, the divisions,
// the lottery and the card pool used to be tabs on two other pages, gated by
// role inside those pages; they are one page now, and this link is what decides
// who is told about it. Member-visible and PLAYER-hidden, matching the read
// access the tabs themselves have always given a member.

import { describe, it, expect, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react';

type Role = 'COMMISSIONER' | 'MEMBER' | 'PLAYER';

const mockSession = jest.fn<() => {
  data: { user: { role: Role } } | null;
  status: 'authenticated' | 'unauthenticated' | 'loading';
}>();

jest.mock('next-auth/react', () => ({
  useSession: () => mockSession(),
}));

// Imported after the mock is registered — jest.mock is hoisted, but the module
// factory above is only used once this module pulls next-auth/react in.
import { useLeagueNav } from '@/components/leagueNav';

function navFor(role: Role | null): { labels: string[]; isMember: boolean } {
  mockSession.mockReturnValue(
    role === null
      ? { data: null, status: 'unauthenticated' }
      : { data: { user: { role } }, status: 'authenticated' },
  );
  const { result } = renderHook(() => useLeagueNav());
  return { labels: result.current.items.map((i) => i.label), isMember: result.current.isMember };
}

describe('useLeagueNav', () => {
  it('shows a signed-out visitor only the dashboard', () => {
    const { labels, isMember } = navFor(null);
    expect(labels).toEqual(['Dashboard']);
    expect(isMember).toBe(false);
  });

  // WHY: the card game is the one feature that is not about running the league,
  // so a PLAYER gets it — and nothing that runs the league.
  it('gives a PLAYER the game but not the league', () => {
    const { labels, isMember } = navFor('PLAYER');
    expect(labels).toEqual(['Dashboard', 'AI Assistant', 'Draft Deck']);
    expect(labels).not.toContain('Commissioner');
    expect(isMember).toBe(false);
  });

  // WHY: a member reads the schedule, the divisions and the lottery — those are
  // the league's own record. Hiding the link would take that away, which is the
  // one thing moving the tabs onto their own page must not do.
  it('gives a MEMBER the Commissioner page', () => {
    const { labels, isMember } = navFor('MEMBER');
    expect(labels).toContain('Commissioner');
    expect(isMember).toBe(true);
  });

  it('gives a COMMISSIONER the same nav as a member', () => {
    expect(navFor('COMMISSIONER').labels).toEqual(navFor('MEMBER').labels);
  });

  it('points Commissioner at its own page', () => {
    mockSession.mockReturnValue({ data: { user: { role: 'COMMISSIONER' } }, status: 'authenticated' });
    const { result } = renderHook(() => useLeagueNav());
    const entry = result.current.items.find((i) => i.label === 'Commissioner');
    expect(entry?.href).toBe('/league/commissioner');
  });
});
