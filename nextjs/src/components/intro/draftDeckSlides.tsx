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
// zero, and it described a pack's tier as a floor when it is the ceiling — the
// guarantee is a count of cards *at* that tier and every other card in the pack
// is drawn from strictly below it.
//
// So no number and no rule below is typed out. Every one is read from the
// module that enforces it — ration.ts for the supplies, tiers.ts for the pack
// odds, roster.ts for the lineup, weeklyGame.ts for the clock. Prose that
// depends on a value being what it is today (a Gold guarantee existing at all,
// a pack having filler in it) branches on the constant rather than assuming it,
// so retuning the game rewrites the explanation instead of falsifying it.
//
// **It is where copy is edited.** Slides are data, built by one function, so a
// future rewording is an edit here and nothing else — no component to unpick,
// no hooks to re-read. DraftDeckIntro.tsx is now just the wiring.

import { IntroList, IntroTerm, type IntroSlide } from './IntroCarousel';
import { CardsArt, TierArt, DeckTabsArt, CommissionerTabsArt } from './IntroArt';
import {
  CARDS_PER_PACK, ELIGIBLE_POSITIONS, PACK_GUARANTEE, POSITION_LABEL,
  TIER_LABEL, TIER_MAX_RANK, TIER_ORDER, WILDCARD_PACK_TIERS,
  WILDCARD_PULL_CHANCE,
} from '@/lib/cards/tiers';
import { ROSTER_SIZE, lineupShape } from '@/lib/cards/roster';
import {
  FIRST_RATION_WEEK, GUARANTEED_GOLD_PACKS, HIGH_SCORE_THRESHOLD,
  PACKS_PER_WEEK, STARTER_GUARANTEED_GOLD, STARTER_PACKS, WILDCARD_SIDES,
} from '@/lib/cards/ration';
import {
  GAME_TIME_ZONE_LABEL, LOCK_DAY_LABEL, LOCK_HOUR, LOCK_MINUTE, MAX_GAME_WEEK,
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
 * the fact, and so an assertion about "two packs a week" does not have to hard
 * code the two — which is the habit that put issue #43 here in the first place.
 */
export function numberWord(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

/** Joins a list the way a sentence does: "a, b and c". */
function sentenceList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "one QB, two RB, two WR, a TE and three FLEX" — read from ROSTER_SLOTS. */
function lineupSentence(): string {
  return sentenceList(lineupShape().map((g) => `${numberWord(g.count)} ${g.label}`));
}

/** "quarterbacks, running backs, wide receivers and tight ends". */
function positionSentence(): string {
  return sentenceList(ELIGIBLE_POSITIONS.map((p) => POSITION_LABEL[p]));
}

/**
 * How a pack's own tier is guaranteed, as a clause per tier that has filler.
 *
 * Bronze is skipped: it guarantees the whole pack because nothing sits below it
 * to fill from, which is the same rule rather than an exception worth a clause.
 */
function guaranteeSentence(): string {
  const withFiller = TIER_ORDER.filter((t) => PACK_GUARANTEE[t] < CARDS_PER_PACK);
  // Only the first clause carries the verb — "a Gold pack holds two, a Silver
  // pack three" is how the sentence would be spoken.
  return sentenceList(withFiller.map((t, i) => (
    `a ${TIER_LABEL[t]} pack ${i === 0 ? 'holds ' : ''}${numberWord(PACK_GUARANTEE[t])}`
  )));
}

/** The tier a wildcard can fall out of, as an adjective — "Silver-or-better". */
function wildcardFloor(): string {
  const lowest = WILDCARD_PACK_TIERS[WILDCARD_PACK_TIERS.length - 1];
  return `${TIER_LABEL[lowest]}-or-better`;
}

// ─── Slides ──────────────────────────────────────────────────────────────────

/**
 * The tour, in order.
 *
 * `isCommissioner` adds one slide rather than changing any other, because the
 * commissioner tools are a tab a member cannot see — explaining them to
 * everybody would be describing a page that is not there.
 */
export function draftDeckSlides({ isCommissioner }: { isCommissioner: boolean }): IntroSlide[] {
  // Round the odds for prose: WILDCARD_PULL_CHANCE is a probability and "one in
  // twenty" is what a member can hold in their head.
  const wildcardOdds = Math.round(1 / WILDCARD_PULL_CHANCE);
  const lockLabel = `${LOCK_DAY_LABEL} ${clockLabel(LOCK_HOUR, LOCK_MINUTE)} ${GAME_TIME_ZONE_LABEL}`;
  const revealLabel = `${REVEAL_DAY_LABEL} ${clockLabel(REVEAL_HOUR)} ${GAME_TIME_ZONE_LABEL}`;

  return [
    {
      key: 'what',
      eyebrow: 'Draft Deck',
      title: 'A card game on top of your league',
      art: <CardsArt />,
      body: (
        <>
          <p>
            Every player from every season your league has played has a card. You open
            packs to find them, submit a lineup of {ROSTER_SIZE} every week, and the
            weeks add up to a season score.
          </p>
          <IntroList
            items={[
              <><IntroTerm>Cards are owned exclusively.</IntroTerm> Once somebody pulls
                a card it is off the board — nobody else in the league can ever have it.
                That makes the pool a race rather than a checklist.</>,
              <><IntroTerm>Your deck is not your lineup.</IntroTerm> The deck is
                everything you own; the lineup is the {ROSTER_SIZE} cards you play this
                week — {lineupSentence()}. There is one quarterback slot and FLEX will
                not take a quarterback, so a pile of them is still one starter.</>,
              <><IntroTerm>A card plays once.</IntroTerm> Every card you field is retired
                for the rest of the season, so the real decision is not just who is best
                — it is which week to spend them in.</>,
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
            items={TIER_ORDER.map((tier) => (
              tier in TIER_MAX_RANK
                ? <><IntroTerm>{TIER_LABEL[tier]}</IntroTerm> — through rank{' '}
                    {TIER_MAX_RANK[tier as keyof typeof TIER_MAX_RANK]} at the position
                    that season.</>
                : <><IntroTerm>{TIER_LABEL[tier]}</IntroTerm> — everybody else.</>
            ))}
          />
          <p className="mt-3">
            A tier is not itself worth points. It tells you how rare a card is and how
            good that player&apos;s season was — what it scores is the points per game on
            its face, in the week you field it.
          </p>
          <p className="mt-3">
            Only {positionSentence()} get cards. Kickers and team defenses do not.
          </p>
        </>
      ),
    },
    {
      key: 'packs',
      eyebrow: 'Draft Deck · Tab 1',
      title: 'Packs',
      art: <DeckTabsArt active="packs" />,
      body: (
        <>
          <p>
            Where cards come from. The counters across the top say how many packs you
            are holding, what you have scored this season, and how much of the pool is
            still unclaimed.
          </p>
          <IntroList
            items={[
              <><IntroTerm>Your ration</IntroTerm> — {numberWord(PACKS_PER_WEEK)} packs a
                week from week {FIRST_RATION_WEEK} on.{' '}
                {GUARANTEED_GOLD_PACKS > 0
                  ? <>{numberWord(GUARANTEED_GOLD_PACKS)} of them{' '}
                      {GUARANTEED_GOLD_PACKS === 1 ? 'is' : 'are'} guaranteed Gold or
                      better.</>
                  : <>Every one of them is rolled honestly — the ration promises you a
                      pack, not a tier, so a Gold pack means you actually rolled one.</>}
                {' '}Week 1 pays no ration at all; the starter grant is that week&apos;s
                handful.</>,
              <><IntroTerm>Your starter grant</IntroTerm> — {numberWord(STARTER_PACKS)} packs
                the first time you open the game,{' '}
                {numberWord(STARTER_GUARANTEED_GOLD)} of them guaranteed Gold or better. It
                is the one supply that promises a tier, because a first sitting of all
                Bronze leaves you nothing to field.</>,
              <><IntroTerm>Bonus packs</IntroTerm> — win a matchup in any of your Sleeper
                leagues, or score more than {HIGH_SCORE_THRESHOLD} in one, and you earn
                an extra pack. One of each a week, however many leagues you play, and
                each is an ordinary pack.</>,
              <><IntroTerm>Wildcards</IntroTerm> — about one {wildcardFloor()} pack
                in {wildcardOdds} hides a die in place of its weakest card. Throw it for
                one to {numberWord(WILDCARD_SIDES)} extra packs.</>,
              <><IntroTerm>The opener</IntroTerm> — {numberWord(CARDS_PER_PACK)} cards a pack, turned
                one at a time. A pack&apos;s tier is what it guarantees, not a floor
                under the rest: {guaranteeSentence()} of its own tier, and the remaining
                cards are drawn from the tiers <em>below</em> it. So the tier on the
                wrapper is the best card in there.</>,
            ]}
          />
        </>
      ),
    },
    {
      key: 'deck',
      eyebrow: 'Draft Deck · Tab 2',
      title: 'Deck',
      art: <DeckTabsArt active="deck" />,
      body: (
        <>
          <p>Everything you own, and the decisions you make with it.</p>
          <IntroList
            items={[
              <><IntroTerm>Tier tiles and filters</IntroTerm> — the four tier tiles are
                also the filter; narrow further by position, season, or whether a card is
                still available to play.</>,
              <><IntroTerm>Retired cards stay here</IntroTerm> — dimmed, stamped with the
                week they played and what they scored. Your deck is the record of your
                season, so nothing ever disappears from it.</>,
              <><IntroTerm>Name them and give them faces</IntroTerm> — tap a card. A
                nickname and a photograph are what make it yours when it turns up in
                {' '}{REVEAL_DAY_LABEL}&apos;s results in front of the league.</>,
            ]}
          />
        </>
      ),
    },
    {
      key: 'lineup',
      eyebrow: 'Draft Deck · Tab 3',
      title: 'Lineup — the week',
      art: <DeckTabsArt active="lineup" />,
      body: (
        <>
          <p>
            The game is played a week at a time. Fill the {ROSTER_SIZE} slots
            — {lineupSentence()} — from cards you have not played yet, submit before the
            deadline, and read the results the next morning.
          </p>
          <IntroList
            items={[
              <><IntroTerm>Submit by {lockLabel}.</IntroTerm> You can keep editing and
                re-submitting right up to it. A week you do not submit scores
                nothing.</>,
              <><IntroTerm>Results at {revealLabel}.</IntroTerm> Everybody&apos;s
                lineup is published at once — every card anybody played, best to worst,
                nicknames and photographs and all.</>,
              <><IntroTerm>Played cards retire.</IntroTerm> The {ROSTER_SIZE} you field
                are gone for the season. Spending your best cards early wins a week;
                saving them wins a different one.</>,
              <><IntroTerm>The weeks add up.</IntroTerm> {MAX_GAME_WEEK} weeks, one score
                each, and the highest total at the end of the season takes it.</>,
            ]}
          />
        </>
      ),
    },
    ...(isCommissioner
      ? [{
          key: 'commissioner',
          eyebrow: 'Commissioner · Draft Deck',
          title: 'Commissioner',
          art: <CommissionerTabsArt active="draft-deck" />,
          body: (
            <>
              <p>
                The pool everybody draws from is not run from here. It is the
                <IntroTerm> Draft Deck</IntroTerm> tab of the
                <IntroTerm> Commissioner</IntroTerm> page, in the sidebar with the
                schedule, the divisions and the lottery — running the league is one
                job in one place, and this page is the game.
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
            move to <IntroTerm>Lineup</IntroTerm>, fill all {ROSTER_SIZE} slots and
            submit. An empty slot scores nothing and a week left unsubmitted scores
            nothing at all — most of the early ground in the standings is lost that way
            rather than to bad pulls.
          </p>
          <p className="mt-3">
            This explanation is always a click away: <IntroTerm>How it works</IntroTerm>,
            beside the page title.
          </p>
        </>
      ),
    },
  ];
}
