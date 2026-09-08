// src/components/intro/AppIntro.tsx
//
// The tour a member gets the first time they land anywhere in the league
// portal: one slide per dashboard tab, in the order the tabs run across the
// top.
//
// Scope is deliberate. Schedules, Divisions and Lottery are commissioner
// plumbing and are not on the tour — they have their own page now, and a member
// who needs it is not the member being introduced to the app. Draft Deck runs
// its own tour when you open it, so it is not on this one either.

'use client';

import { usePathname } from 'next/navigation';
import { IntroCarousel, IntroList, type IntroSlide } from './IntroCarousel';
import { TabBarArt } from './IntroArt';
import { requestIntro, useIntro } from './useIntro';

export const APP_INTRO_ID = 'app';

/** Replays the tour from a "How it works" control. Beats "Don't show again". */
export function openAppIntro(): void {
  requestIntro(APP_INTRO_ID, true);
}

export function AppIntro() {
  const pathname = usePathname();

  // Mounted in the league layout, so it is live on every page of the portal.
  // Draft Deck is the exception: it runs its own tour, and two carousels
  // stacked on one another is nobody's welcome. A member who lands there first
  // still gets this tour on their next page, since the flag flips back.
  const auto = !pathname.startsWith('/league/cards');

  const { open, muted, close, setMuted } = useIntro(APP_INTRO_ID, auto);

  const slides: IntroSlide[] = [
    {
      key: 'welcome',
      eyebrow: 'Commissioner Suite',
      // Nothing lit: this slide is about the bar, not any one tab on it.
      art: <TabBarArt active={[]} />,
      title: 'Your league dashboard',
      body: <p>Analyze your team. Review statistics. Stay up to date with the latest.</p>,
    },
    {
      key: 'matchup',
      eyebrow: 'Dashboard · Tab 1',
      title: 'Matchup Analysis',
      art: <TabBarArt active="matchup" />,
      body: (
        <IntroList
          items={[
            <>Review your starters versus your opponent&apos;s.</>,
            <>Low score in red is your team&apos;s bust score. High score in green is your
              team&apos;s boom score.</>,
            <>The number range is worst to best (e.g., 0-22 means their bust is 0 points,
              but their boom is 22).</>,
            <>Each player has an info card next to their name with weather, team
              they&apos;re facing, and odds from the game.</>,
          ]}
        />
      ),
    },
    {
      key: 'waivers',
      eyebrow: 'Dashboard · Tab 2',
      title: 'Waiver Wire',
      art: <TabBarArt active="waivers" />,
      body: (
        <IntroList
          items={[
            <>Find the best waiver fit for your team.</>,
            <>Review your thinnest spots.</>,
            <>Search through the best fits based on your weak points.</>,
            <>Player points are the average for the last 3 weeks of 2025.</>,
            <>Each player has an info card next to their name with weather, team
              they&apos;re facing, and odds from the game.</>,
          ]}
        />
      ),
    },
    {
      key: 'trades',
      eyebrow: 'Dashboard · Tab 3',
      title: 'Trade Finder',
      art: <TabBarArt active="trades" />,
      body: (
        <IntroList
          items={[
            <>Self explanatory… it gives you some ideas on trades. Let &apos;em rip.</>,
          ]}
        />
      ),
    },
    {
      key: 'statistics-news',
      eyebrow: 'Dashboard · Tabs 4 and 5',
      title: 'Statistics and News',
      // The pair is one slide, so both tabs are lit.
      art: <TabBarArt active={['statistics', 'news']} />,
      body: (
        <IntroList
          items={[
            <>Statistics for everything in the database.</>,
            <>News from all around the league.</>,
          ]}
        />
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
      doneLabel="Start exploring"
    />
  );
}
