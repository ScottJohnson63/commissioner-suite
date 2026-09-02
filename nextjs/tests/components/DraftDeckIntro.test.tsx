// tests/components/DraftDeckIntro.test.tsx
//
// The Draft Deck tour, and through it the carousel every tour is drawn in.
//
// Three things here are behaviour rather than copy, and each has bitten a
// carousel somewhere before: it must open by itself exactly once, a member who
// asks it to stop must actually stop it, and "How it works" must beat that —
// a control that silently does nothing is worse than no control.

import { describe, it, expect, beforeEach } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DraftDeckIntro, openDraftDeckIntro, requestDraftDeckIntro } from '@/components/intro/DraftDeckIntro';

function renderTour(isCommissioner = false) {
  return render(<DraftDeckIntro isCommissioner={isCommissioner} />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('DraftDeckIntro', () => {
  it('opens itself on a first visit and lands on the overview', () => {
    renderTour();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('A card game on top of your league')).toBeTruthy();
  });

  it('pages forward and back, and closes on the last slide', async () => {
    const user = userEvent.setup();
    renderTour();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Tiers come from real season finishes')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('A card game on top of your league')).toBeTruthy();

    // Straight to the end, then out.
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    await user.click(screen.getByRole('button', { name: "Let's play" }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open a second time once it has been seen', async () => {
    const user = userEvent.setup();
    const first = renderTour();
    await user.click(screen.getByRole('button', { name: 'Close introduction' }));
    first.unmount();

    renderTour();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reopens when the sidebar asks for it, and not once muted', async () => {
    const user = userEvent.setup();
    renderTour();
    await user.click(screen.getByRole('button', { name: 'Close introduction' }));

    act(() => { requestDraftDeckIntro(); });
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: /Don't show this again/ }));
    await user.click(screen.getByRole('button', { name: 'Close introduction' }));

    act(() => { requestDraftDeckIntro(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('still opens from "How it works" after being muted', async () => {
    const user = userEvent.setup();
    renderTour();
    await user.click(screen.getByRole('checkbox', { name: /Don't show this again/ }));
    await user.click(screen.getByRole('button', { name: 'Close introduction' }));

    act(() => { openDraftDeckIntro(); });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderTour();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // The Commissioner tab is role-gated in the page, so explaining it to a
  // member who cannot see it would be describing a tab that is not there.
  it('describes the Commissioner tab only for a commissioner', async () => {
    const user = userEvent.setup();
    const member = renderTour(false);
    expect(screen.getByText('1 / 5')).toBeTruthy();
    expect(screen.queryByText('Commissioner')).toBeNull();
    member.unmount();
    window.localStorage.clear();

    renderTour(true);
    expect(screen.getByText('1 / 6')).toBeTruthy();
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    expect(screen.getByRole('heading', { name: 'Commissioner' })).toBeTruthy();
  });
});
