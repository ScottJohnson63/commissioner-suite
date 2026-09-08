// tests/components/CardsDialog.test.tsx
//
// The chrome the Packs, Results and Card dialogs all share. Its own behaviour
// is a title and a close control, which the About dialog's test already covers
// through it; what is worth pinning here is the one thing a caller can change
// and the one thing a phone depends on.
//
// `open` toggles visibility rather than rendering, so a pack mid-reveal keeps
// its state while the dialog is shut — a test that only looked for the markup
// would pass either way, so this asks whether the dialog is *exposed*.
//
// `fitViewport` is what makes the card dialog a single pane on a phone: its
// body holds still instead of scrolling. Only up to `sm` and only in portrait,
// because that is the one case a child can be sized to fit — a phone on its
// side has ~320px of height for a form that needs more, and a body that cannot
// scroll there would clip the lineup off the bottom.

import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { CardsDialog } from '@/components/cards/CardsDialog';

/** The panel's last child is the body — the element that does the scrolling. */
function body() {
  const panel = screen.getByRole('dialog');
  return panel.lastElementChild as HTMLElement;
}

describe('CardsDialog', () => {
  it('keeps its children mounted but unexposed while closed', () => {
    render(
      <CardsDialog open={false} title="Draft Deck · Card" onClose={() => {}}>
        <p>a pack mid-reveal</p>
      </CardsDialog>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    // Still in the tree, which is what lets state survive a stray tap outside.
    expect(screen.getByText('a pack mid-reveal')).toBeTruthy();
  });

  it('scrolls its body by default', () => {
    render(
      <CardsDialog open title="Draft Deck · Packs" onClose={() => {}}>
        <p>taller than the panel</p>
      </CardsDialog>,
    );

    expect(body().className).toContain('overflow-y-auto');
    expect(body().className).not.toContain('overflow-hidden');
  });

  it('holds the body still on an upright phone when asked to fit the viewport', () => {
    render(
      <CardsDialog open title="Draft Deck · Card" onClose={() => {}} fitViewport>
        <p>one card, sized to the pane</p>
      </CardsDialog>,
    );

    // Fixed on a portrait phone…
    expect(body().className).toContain('max-sm:portrait:overflow-hidden');
    // …and still scrollable everywhere else, so nothing is ever cut off.
    expect(body().className).toContain('overflow-y-auto');
  });
});
