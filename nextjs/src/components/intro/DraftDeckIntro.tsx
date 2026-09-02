// src/components/intro/DraftDeckIntro.tsx
//
// The game's own tour: what Draft Deck is, where cards come from, and what each
// of its three tabs holds.
//
// It opens on a first visit and whenever the sidebar's Draft Deck link is
// clicked — that link calls requestIntro before it navigates, so the ask
// survives the route change. "Don't show this again" turns the automatic
// opening off; the "How it works" button beside the page title still works.
//
// The balance numbers are imported from lib/cards rather than typed out, so a
// commissioner retuning the ration cannot leave the explanation lying. Only
// modules that are free of Prisma are safe to import here — tiers.ts and
// roster.ts are pure, allowance.ts and bonus.ts are not, so the two ration
// numbers below are stated in prose instead.

'use client';

import { IntroCarousel, IntroList, IntroTerm, type IntroSlide } from './IntroCarousel';
import { CardsArt, TierArt, DeckTabsArt } from './IntroArt';
import { requestIntro, useIntro } from './useIntro';
import {
  CARDS_PER_PACK, DECK_POINTS, TIER_MAX_RANK, WILDCARD_PULL_CHANCE,
} from '@/lib/cards/tiers';
import { ROSTER_SIZE } from '@/lib/cards/roster';

export const CARDS_INTRO_ID = 'cards';

/** Replays the game's tour from a "How it works" control. */
export function openDraftDeckIntro(): void {
  requestIntro(CARDS_INTRO_ID, true);
}

/** Asks for it from another page — the sidebar link, which then navigates. */
export function requestDraftDeckIntro(): void {
  requestIntro(CARDS_INTRO_ID);
}

export function DraftDeckIntro({ isCommissioner }: { isCommissioner: boolean }) {
  const { open, muted, close, setMuted } = useIntro(CARDS_INTRO_ID);

  const wildcardOdds = Math.round(1 / WILDCARD_PULL_CHANCE);

  const slides: IntroSlide[] = [
    {
      key: 'what',
      eyebrow: 'Draft Deck',
      title: 'A card game on top of your league',
      art: <CardsArt />,
      body: (
        <>
          <p>
            Every player from every season your league has played has a card. You open
            packs to find them, field the best {ROSTER_SIZE} you own, and the league is
            ranked on what that lineup scores.
          </p>
          <IntroList
            items={[
              <><IntroTerm>Cards are owned exclusively.</IntroTerm> Once somebody pulls
                a card it is off the board — nobody else in the league can ever have it.
                That makes the pool a race rather than a checklist.</>,
              <><IntroTerm>Your deck is not your lineup.</IntroTerm> The deck is
                everything you own; the lineup is the {ROSTER_SIZE} cards you start. A
                second elite running back is worth nothing if a better one already holds
                the slot.</>,
            ]}
          />
        </>
      ),
    },
    {
      key: 'tiers',
      eyebrow: 'The rules',
      title: 'Tiers come from real season finishes',
      art: <TierArt />,
      body: (
        <>
          <p>
            A card&apos;s tier is how that player finished at their position in that
            season — so 2025&apos;s QB3 is a Hall of Fame card forever, and a quiet year
            from the same player is a Bronze one.
          </p>
          <IntroList
            items={[
              <><IntroTerm>Hall of Fame</IntroTerm> — top {TIER_MAX_RANK.HALL_OF_FAME} at
                the position, worth {DECK_POINTS.HALL_OF_FAME} deck points.</>,
              <><IntroTerm>Gold</IntroTerm> — through
                rank {TIER_MAX_RANK.GOLD}, {DECK_POINTS.GOLD} points.</>,
              <><IntroTerm>Silver</IntroTerm> — through
                rank {TIER_MAX_RANK.SILVER}, {DECK_POINTS.SILVER} points.</>,
              <><IntroTerm>Bronze</IntroTerm> — everybody
                else, {DECK_POINTS.BRONZE} points.</>,
            ]}
          />
          <p className="mt-3">
            Quarterbacks, running backs, receivers and tight ends only — kickers and team
            defenses do not get cards.
          </p>
        </>
      ),
    },
    {
      key: 'packs',
      eyebrow: 'Draft Deck · Tab 1',
      title: 'Packs',
      art: <DeckTabsArt active="packs" showCommissioner={isCommissioner} />,
      body: (
        <>
          <p>
            Where cards come from. The counters across the top say how many packs you are
            holding, what your lineup is scoring, and how much of the pool is still
            unclaimed.
          </p>
          <IntroList
            items={[
              <><IntroTerm>Your ration</IntroTerm> — two packs a week from week 2 on, one
                of them guaranteed Gold or better. Week 1 is a five-pack starter grant
                instead, so your first sitting is one clean handful.</>,
              <><IntroTerm>Bonus packs</IntroTerm> — win a matchup in any of your Sleeper
                leagues, or score over 100 in one, and you earn an extra pack. One of
                each a week, however many leagues you play.</>,
              <><IntroTerm>Wildcards</IntroTerm> — about one Silver-or-better pack
                in {wildcardOdds} hides a die instead of its weakest card. Throw it for
                one to six extra packs.</>,
              <><IntroTerm>The opener</IntroTerm> — {CARDS_PER_PACK} cards a pack, turned
                one at a time. The tier of the pack sets the floor; the rest fills from
                below.</>,
            ]}
          />
        </>
      ),
    },
    {
      key: 'deck',
      eyebrow: 'Draft Deck · Tab 2',
      title: 'Deck',
      art: <DeckTabsArt active="deck" showCommissioner={isCommissioner} />,
      body: (
        <>
          <p>Everything you own, and the decisions you make with it.</p>
          <IntroList
            items={[
              <><IntroTerm>Your rank</IntroTerm> — where you sit, what your lineup scores
                per game, and how far behind the person above you it leaves you. That gap
                is the reason to go and fill a slot.</>,
              <><IntroTerm>The lineup</IntroTerm> — {ROSTER_SIZE} slots: QB, two RB, two
                WR, TE and three FLEX. Only started cards score, and swapping one
                re-ranks the whole league.</>,
              <><IntroTerm>Tier tiles and filters</IntroTerm> — the four tier tiles are
                also the filter; narrow further by position or by season to find the card
                you are after.</>,
              <><IntroTerm>Standings</IntroTerm> — the whole league by lineup points per
                game, at the bottom of the tab.</>,
            ]}
          />
        </>
      ),
    },
    ...(isCommissioner
      ? [{
          key: 'commissioner',
          eyebrow: 'Draft Deck · Tab 3',
          title: 'Commissioner',
          art: <DeckTabsArt active="commissioner" showCommissioner />,
          body: (
            <>
              <p>
                Yours only, and right-aligned in the bar for the same reason the
                dashboard&apos;s member tabs are: this is administration, not the thing
                you came for.
              </p>
              <IntroList
                items={[
                  <><IntroTerm>Build the pool</IntroTerm> — no cards exist until a season
                    is turned into them. Nobody can open a pack before this runs.</>,
                  <><IntroTerm>Backfill older seasons</IntroTerm> — ownership is
                    exclusive, so a pool that runs dry ends the game. Adding earlier
                    seasons is how you widen it.</>,
                ]}
              />
            </>
          ),
        } satisfies IntroSlide]
      : []),
    {
      key: 'start',
      eyebrow: 'Draft Deck',
      title: 'Go and open one',
      art: <CardsArt />,
      body: (
        <>
          <p>
            Start on <IntroTerm>Packs</IntroTerm> and spend what you are holding, then
            move to <IntroTerm>Deck</IntroTerm> and fill all {ROSTER_SIZE} lineup slots —
            an empty slot scores nothing, and most of the early ground in the standings
            is lost that way rather than to bad pulls.
          </p>
          <p className="mt-3">
            This explanation is always a click away: <IntroTerm>How it works</IntroTerm>,
            beside the page title.
          </p>
        </>
      ),
    },
  ];

  return (
    <IntroCarousel
      slides={slides}
      open={open}
      onClose={close}
      muted={muted}
      onMuted={setMuted}
      doneLabel="Let's play"
    />
  );
}
