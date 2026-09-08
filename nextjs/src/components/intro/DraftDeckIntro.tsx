// src/components/intro/DraftDeckIntro.tsx
//
// The game's own tour: what Draft Deck is, where cards come from, how a week is
// played, and what each of its tabs holds.
//
// It opens on a first visit and whenever the sidebar's Draft Deck link is
// clicked — that link calls requestIntro before it navigates, so the ask
// survives the route change. "Don't show this again" turns the automatic
// opening off; the "How it works" button beside the page title still works.
//
// What it *says* lives in draftDeckSlides.tsx, which reads every number and
// every rule from the modules that enforce them. That split is issue #43's:
// this file is the wiring, and the wiring had nothing to do with the tour
// having gone out of date. Balance numbers that were once stated in prose here,
// because the modules holding them import Prisma and could not be reached from
// a client component, now come from ration.ts and tiers.ts — which import none.
//
// It takes no props. It used to take `isCommissioner`, for a slide about the
// commissioner's pool tools; that slide is gone, and with it the only reason
// the card page computed the role at all.

'use client';

import { IntroCarousel } from './IntroCarousel';
import { draftDeckSlides } from './draftDeckSlides';
import { requestIntro, useIntro } from './useIntro';

export const CARDS_INTRO_ID = 'cards';

/** Replays the game's tour from a "How it works" control. */
export function openDraftDeckIntro(): void {
  requestIntro(CARDS_INTRO_ID, true);
}

/** Asks for it from another page — the sidebar link, which then navigates. */
export function requestDraftDeckIntro(): void {
  requestIntro(CARDS_INTRO_ID);
}

export function DraftDeckIntro() {
  const { open, muted, close, setMuted } = useIntro(CARDS_INTRO_ID);

  return (
    <IntroCarousel
      slides={draftDeckSlides()}
      open={open}
      onClose={close}
      muted={muted}
      onMuted={setMuted}
      doneLabel="Let's play"
    />
  );
}
