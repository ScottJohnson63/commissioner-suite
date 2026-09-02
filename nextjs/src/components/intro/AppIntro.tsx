// src/components/intro/AppIntro.tsx
//
// The tour a member gets the first time they land anywhere in the league
// portal: what the three dashboard tabs are for, and where the card game is.
//
// Scope is deliberate. The Schedules, Divisions and Lottery tabs on the right
// of the dashboard are commissioner plumbing and are not on the tour — the
// right-hand side of that bar is administration, and a member who needs it is
// not the member being introduced to the app. The tour ends by pointing at
// Draft Deck, which then explains itself — see DraftDeckIntro.

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { IntroCarousel, IntroList, IntroTerm, type IntroSlide } from './IntroCarousel';
import { TabBarArt, SidebarArt } from './IntroArt';
import { requestIntro, useIntro } from './useIntro';
import { CARDS_INTRO_ID } from './DraftDeckIntro';

export const APP_INTRO_ID = 'app';

/** Replays the tour from a "How it works" control. Beats "Don't show again". */
export function openAppIntro(): void {
  requestIntro(APP_INTRO_ID, true);
}

export function AppIntro() {
  const router = useRouter();
  const pathname = usePathname();

  // Mounted in the league layout, so it is live on every page of the portal.
  // Draft Deck is the exception: it runs its own tour, and two carousels
  // stacked on one another is nobody's welcome. A member who lands there first
  // still gets this tour on their next page, since the flag flips back.
  const auto = !pathname.startsWith('/league/cards');

  const { open, muted, close, setMuted } = useIntro(APP_INTRO_ID, auto);

  function toDraftDeck() {
    close();
    // Queue the game's own tour so it is waiting when the route settles.
    requestIntro(CARDS_INTRO_ID, true);
    router.push('/league/cards');
  }

  const slides: IntroSlide[] = [
    {
      key: 'welcome',
      eyebrow: 'Commissioner Suite',
      title: 'Your league, in one place',
      art: <TabBarArt active="league" />,
      body: (
        <>
          <p>
            The dashboard is the front door. Three tabs run across the top of it, and each
            one answers a different question about your fantasy season.
          </p>
          <IntroList
            items={[
              <><IntroTerm>League</IntroTerm> — your team this week.</>,
              <><IntroTerm>Statistics</IntroTerm> — who is producing, league-wide.</>,
              <><IntroTerm>News</IntroTerm> — what happened today.</>,
            ]}
          />
          <p className="mt-3">
            Statistics and News are readable without an account. League needs your Sleeper
            account connected, which is what the selector in the top right is for.
          </p>
        </>
      ),
    },
    {
      key: 'league',
      eyebrow: 'Dashboard · Tab 1',
      title: 'League',
      art: <TabBarArt active="league" />,
      body: (
        <>
          <p>
            Everything here is about the team you actually field, read live from Sleeper for
            whichever league you picked in the selector at the top right.
          </p>
          <IntroList
            items={[
              <><IntroTerm>Matchup Analysis</IntroTerm> — this week&apos;s opponent, side by
                side with your starters, so you can see where the game is won or lost.</>,
              <><IntroTerm>Waiver Wire</IntroTerm> — free agents worth a claim in your league,
                ranked against the players you already have.</>,
              <><IntroTerm>Trade Finder</IntroTerm> — trades that fit your roster holes and
                the other manager&apos;s, rather than trades that only help you.</>,
            ]}
          />
          <p className="mt-3">
            Each panel loads on demand — press its button when you want the numbers, so
            nothing burns a Sleeper call you did not ask for.
          </p>
        </>
      ),
    },
    {
      key: 'statistics',
      eyebrow: 'Dashboard · Tab 2',
      title: 'Statistics',
      art: <TabBarArt active="statistics" />,
      body: (
        <>
          <p>The league-wide view: what the market is doing and who is producing.</p>
          <IntroList
            items={[
              <><IntroTerm>Trending ticker</IntroTerm> — the players being added and dropped
                fastest across Sleeper right now, cycling across the top.</>,
              <><IntroTerm>Season leaders</IntroTerm> — sortable leaders from nfl_data_py.
                Pick a season and a category to see who finished where.</>,
              <><IntroTerm>Statistics resources</IntroTerm> — a short list of the outside
                sites worth opening, from Pro Football Reference to Next Gen Stats.</>,
            ]}
          />
          <p className="mt-3">
            Season finishes are also what the card game is built on — the top five at a
            position in a season are its Hall of Fame cards.
          </p>
        </>
      ),
    },
    {
      key: 'news',
      eyebrow: 'Dashboard · Tab 3',
      title: 'News',
      art: <TabBarArt active="news" />,
      body: (
        <>
          <p>
            Headlines from four feeds in one list, newest first, each tagged with where it
            came from.
          </p>
          <IntroList
            items={[
              <><IntroTerm>Filter by source</IntroTerm> — All, ESPN, Yahoo Sports,
                Pro Football Talk or CBS Sports.</>,
              <><IntroTerm>Every headline opens out</IntroTerm> — stories link to the
                publisher in a new tab; nothing is rewritten here.</>,
            ]}
          />
          <p className="mt-3">
            Like Statistics, this tab is public — you can send it to someone in the league
            who has never signed in.
          </p>
        </>
      ),
    },
    {
      key: 'draft-deck',
      eyebrow: 'The sidebar',
      title: 'Then there is Draft Deck',
      art: <SidebarArt />,
      body: (
        <>
          <p>
            The last thing on the tour is the one that is not about running your league.
            <IntroTerm> Draft Deck</IntroTerm> is a card game played on top of it: you open
            packs, collect players from every season your league has played, and field a
            nine-card lineup against everybody else.
          </p>
          <p className="mt-3">
            It is in the sidebar on the left. Open it and it will explain its own rules —
            or press the button below to go there now.
          </p>
        </>
      ),
      action: { label: 'Open Draft Deck', onClick: toDraftDeck },
    },
  ];

  return (
    <IntroCarousel
      slides={slides}
      open={open}
      onClose={close}
      muted={muted}
      onMuted={setMuted}
      doneLabel="Start exploring"
    />
  );
}
