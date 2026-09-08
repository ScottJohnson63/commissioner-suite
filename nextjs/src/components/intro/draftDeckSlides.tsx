// src/components/intro/draftDeckSlides.tsx
//
// What the Draft Deck tour says, separated from the carousel that draws it.
//
// Two jobs, both of them issue #43's.
//
// **It is the one place the rules are written.** The tour is the only page in
// the app whose entire purpose is to state the game's rules, which makes it the
// one page that silently lies when a rule changes. It had: it promised "one of
// them guaranteed Gold or better" for as long as GUARANTEED_GOLD_PACKS had been
// zero, and it described a pack's tier as a floor when it is the ceiling.
//
// So no number and no rule below is typed out. Every one is read from the
// module that enforces it — tiers.ts for the bands and the games floor,
// ration.ts for the wildcard die and the portrait cap, weeklyGame.ts for the
// clock. Prose that depends on a value being what it is today branches on the
// constant rather than assuming it, so retuning the game rewrites the
// explanation instead of falsifying it.
//
// Anything the game does not enforce is not stated here at all. The tour was
// cut back to the rules a member needs before their first pack — the pack
// arithmetic, the ration, the counters and the commissioner tools all came out
// — because a shorter tour that is true beats a complete one nobody finishes.
//
// **It is where copy is edited.** Slides are data, built by one function, so a
// future rewording is an edit here and nothing else — no component to unpick,
// no hooks to re-read. DraftDeckIntro.tsx is now just the wiring.

import { IntroList, type IntroSlide } from './IntroCarousel';
import { CardsArt, TierArt, DeckTabsArt } from './IntroArt';
import {
  MIN_GAMES_FOR_TIER, TIER_LABEL, TIER_MAX_RANK, TIER_ORDER, WILDCARD_PACK_TIERS,
} from '@/lib/cards/tiers';
import { MAX_CUSTOMIZATION_PACKS } from '@/lib/cards/ration';
import {
  GAME_TIME_ZONE_LABEL, LOCK_DAY_LABEL, LOCK_HOUR, LOCK_MINUTE,
  REVEAL_DAY_LABEL, REVEAL_HOUR, clockLabel,
} from '@/lib/cards/weeklyGame';

// ─── Prose helpers ───────────────────────────────────────────────────────────

const WORDS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

/**
 * A small count as a word — "two packs a week" rather than "2 packs a week".
 *
 * The tour is written in sentences, and a numeral mid-sentence reads like a
 * spec. Anything past twelve is left as a numeral, which is where a written-out
 * number stops helping.
 *
 * Exported so the tests can state an expectation the same way the slide states
 * the fact, rather than hard coding the number — which is the habit that put
 * issue #43 here in the first place.
 */
export function numberWord(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

/**
 * A rank as a placing — "1st", "22nd", "13th".
 *
 * The tiers slide states its bands as placings because that is what they are:
 * a finish at a position in a season, not a quantity of anything.
 */
export function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:  return `${n}st`;
    case 2:  return `${n}nd`;
    case 3:  return `${n}rd`;
    default: return `${n}th`;
  }
}

/** The tier a wildcard can fall out of, as an adjective — "Silver or better". */
function wildcardFloor(): string {
  return `${TIER_LABEL[WILDCARD_PACK_TIERS[WILDCARD_PACK_TIERS.length - 1]]} or better`;
}

/**
 * One bullet per tier: its name and the placings that earn it.
 *
 * Walked in TIER_ORDER off TIER_MAX_RANK, so each band starts where the one
 * above it ended and the last tier — which has no maximum, because it is what
 * everything below the others falls into — is named rather than numbered. A
 * band cannot be stated here that the game does not assign in tierForRank.
 */
function tierBullets(): string[] {
  let first = 1;
  return TIER_ORDER.map((tier) => {
    const max = TIER_MAX_RANK[tier as keyof typeof TIER_MAX_RANK] as number | undefined;
    const range = max === undefined
      ? 'everyone else'
      : `${ordinal(first)} through ${ordinal(max)}`;
    if (max !== undefined) first = max + 1;
    return `${TIER_LABEL[tier]}: ${range}`;
  });
}

// ─── Slides ──────────────────────────────────────────────────────────────────

/** The tour, in order. */
export function draftDeckSlides(): IntroSlide[] {
  const lockLabel = `${LOCK_DAY_LABEL} @ ${clockLabel(LOCK_HOUR, LOCK_MINUTE)} ${GAME_TIME_ZONE_LABEL} time`;
  const revealLabel = `${REVEAL_DAY_LABEL} @ ${clockLabel(REVEAL_HOUR)} ${GAME_TIME_ZONE_LABEL} time`;

  return [
    {
      key: 'what',
      eyebrow: 'Draft Deck',
      title: 'Draft Deck. Official card game for Fantasy Football.',
      art: <CardsArt />,
      body: (
        <>
          <p className="font-semibold" style={{ color: '#e8e6df' }}>How it works</p>
          <IntroList
            items={[
              'Open new packs to build your deck.',
              'Use your deck to set your lineup.',
              'Outscore the league at the end of the season.',
            ]}
          />
        </>
      ),
    },
    {
      key: 'tiers',
      eyebrow: 'The rules',
      title: 'Tiers:',
      art: <TierArt />,
      body: (
        <>
          <IntroList items={tierBullets()} />
          <p className="mt-3 italic">
            All rankings are based on a minimum of {MIN_GAMES_FOR_TIER} games played
            during the season listed on the card.
          </p>
        </>
      ),
    },
    {
      key: 'wildcard',
      eyebrow: 'Draft Deck · Packs',
      title: 'Wildcards',
      art: <DeckTabsArt active="packs" />,
      body: (
        <p>
          Each {wildcardFloor()} pack holds the possibility of holding a wildcard. This
          grants you a dice roll. Roll it to see how many packs you win!
        </p>
      ),
    },
    {
      key: 'customize',
      eyebrow: 'Draft Deck · Deck',
      title: 'Customize your deck.',
      art: <DeckTabsArt active="deck" />,
      body: (
        <p>
          Click on a card in your deck to customize them. You can give them a nickname
          or a custom photo. Earn an extra pack for players that don&apos;t have a photo
          by uploading an image (limit {MAX_CUSTOMIZATION_PACKS}).
        </p>
      ),
    },
    {
      key: 'lineup',
      eyebrow: 'Draft Deck · Lineup',
      title: 'Lineup',
      art: <DeckTabsArt active="lineup" />,
      body: (
        <IntroList
          items={[
            'Set your lineup by filling in the empty spots.',
            'The players you set will retire when played.',
            `Submit it by ${lockLabel} or lose out on points for the week.`,
            `View the league results on ${revealLabel}.`,
            'Most accrued points at the end of the season wins!',
          ]}
        />
      ),
    },
    {
      key: 'start',
      eyebrow: 'Draft Deck',
      title: 'Open a pack and get started!',
      art: <CardsArt />,
      body: null,
    },
  ];
}
