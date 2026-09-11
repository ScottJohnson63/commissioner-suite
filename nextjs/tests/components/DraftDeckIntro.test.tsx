// tests/components/DraftDeckIntro.test.tsx
//
// The Draft Deck tour, and through it the carousel every tour is drawn in.
//
// Three things here are behaviour rather than copy, and each has bitten a
// carousel somewhere before: it must open by itself exactly once, a member who
// asks it to stop must actually stop it, and "How it works" must beat that —
// a control that silently does nothing is worse than no control.
//
// The rest is copy, and copy in this component is load-bearing: the tour is the
// only place the game's rules are written down for a member, so a slide that
// disagrees with the code is a rule nobody is playing by. It did disagree — for
// months it promised a Gold pack a week that GUARANTEED_GOLD_PACKS had stopped
// granting, and it called a pack's tier a floor when it is the ceiling. The
// second block below is what makes that a failing test rather than a bug
// report: every expectation is built from the constant the game enforces, so
// retuning the game moves the assertion and the slide together, and rewording
// the slide without checking the rule fails. See issue #43.

import { describe, it, expect, beforeEach } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DraftDeckIntro, openDraftDeckIntro, requestDraftDeckIntro } from '@/components/intro/DraftDeckIntro';
import { ordinal } from '@/components/intro/draftDeckSlides';
import { CARD_DETAIL_CALLOUTS } from '@/components/intro/IntroArt';
import {
  MIN_GAMES_FOR_TIER, TIER_LABEL, TIER_MAX_RANK, TIER_ORDER, WILDCARD_PACK_TIERS,
} from '@/lib/cards/tiers';
import {
  BONUS_KINDS, HIGH_SCORE_THRESHOLD, MAX_CUSTOMIZATION_PACKS,
} from '@/lib/cards/ration';
import {
  GAME_TIME_ZONE_LABEL, LOCK_DAY_LABEL, LOCK_HOUR, LOCK_MINUTE,
  REVEAL_DAY_LABEL, REVEAL_HOUR, clockLabel,
} from '@/lib/cards/weeklyGame';

/** Every slide, in order — the tour is the same for everybody. */
const SLIDES = [
  'Draft Deck. Official card game for Fantasy Football.',
  'Card Details',
  'Tiers:',
  'Wild Card',
  'Customize your deck.',
  'Lineup',
  'Open a pack and get started!',
];

function renderTour() {
  return render(<DraftDeckIntro />);
}

/**
 * Jumps straight to a slide and hands back everything the dialog says.
 *
 * Through the dots rather than by clicking Next repeatedly, so inserting a
 * slide does not renumber every assertion below. The artwork's text lands in
 * here too, which is deliberate — a picture that contradicts the paragraph
 * beside it is the same bug as a paragraph that contradicts the code.
 */
async function slideText(
  user: ReturnType<typeof userEvent.setup>, title: string,
): Promise<string> {
  await user.click(screen.getByRole('button', { name: `Go to ${title}` }));
  return screen.getByRole('dialog').textContent ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('DraftDeckIntro', () => {
  it('opens itself on a first visit and lands on the overview', () => {
    renderTour();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(SLIDES[0])).toBeTruthy();
  });

  it('pages forward and back, and closes on the last slide', async () => {
    const user = userEvent.setup();
    renderTour();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(SLIDES[1])).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(SLIDES[0])).toBeTruthy();

    for (let i = 0; i < SLIDES.length - 1; i++) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    expect(screen.getByText(SLIDES[SLIDES.length - 1])).toBeTruthy();

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

  // The commissioner's pool tools had a slide of their own and no longer do,
  // which is why the component takes no props: there is one tour, and every
  // member sees the same six slides.
  it('shows the same slides to everybody', async () => {
    const user = userEvent.setup();
    renderTour();
    expect(screen.getByText(`1 / ${SLIDES.length}`)).toBeTruthy();

    for (const title of SLIDES) {
      expect(await slideText(user, title)).toContain(title);
    }
    expect(screen.queryByText('Commissioner')).toBeNull();
  });
});

// Every expectation here is composed from the constant the game reads at
// runtime. None of them restates a number, which is the point: a test that
// hard coded "1st through 5th" would have gone stale beside the slide it was
// supposed to be guarding.
describe('DraftDeckIntro — the rules it states', () => {
  it('states each tier band as the placings tierForRank actually assigns', async () => {
    const user = userEvent.setup();
    renderTour();
    const tiers = await slideText(user, 'Tiers:');

    let first = 1;
    for (const tier of TIER_ORDER) {
      const max = TIER_MAX_RANK[tier as keyof typeof TIER_MAX_RANK] as number | undefined;
      if (max === undefined) {
        // The open-ended tier is named, not numbered — it is what everything
        // below the others falls into.
        expect(tiers).toContain(`${TIER_LABEL[tier]}: everyone else`);
        expect(tiers).toContain(`${first}+`);                 // the artwork's open block
      } else {
        expect(tiers).toContain(
          `${TIER_LABEL[tier]}: ${ordinal(first)} through ${ordinal(max)}`,
        );
        expect(tiers).toContain(`${first}–${max}`);      // the artwork's closed block
        first = max + 1;
      }
    }
  });

  // Bands are consecutive: Silver starts at 11th because rank 10 is Gold, which
  // is what tierForRank does. Stating it as "10th through 30th" would put one
  // finisher in two tiers at once — see the note on TIER_MAX_RANK.
  it('does not let two tiers claim the same placing', async () => {
    const user = userEvent.setup();
    renderTour();
    const tiers = await slideText(user, 'Tiers:');

    const closed = TIER_ORDER
      .map((t) => TIER_MAX_RANK[t as keyof typeof TIER_MAX_RANK] as number | undefined)
      .filter((max): max is number => max !== undefined);

    for (const max of closed.slice(0, -1)) {
      expect(tiers).toContain(`through ${ordinal(max)}`);      // one tier ends here
      expect(tiers).toContain(`${ordinal(max + 1)} through`);  // the next starts after
      expect(tiers).not.toContain(`${ordinal(max)} through`);  // and never on it
    }
  });

  it('numbers the card-detail bullets the way the artwork numbers its rings', async () => {
    const user = userEvent.setup();
    renderTour();
    const details = await slideText(user, 'Card Details');

    CARD_DETAIL_CALLOUTS.forEach((callout, i) => {
      expect(details).toContain(`${i + 1} - ${callout}`);
    });
  });

  it('states the games floor the ranking is actually built on', async () => {
    const user = userEvent.setup();
    renderTour();
    const tiers = await slideText(user, 'Tiers:');

    // A minimum, not an exact count: rankSeason sorts players below
    // MIN_GAMES_FOR_TIER beneath everyone who cleared it rather than dropping
    // them, so a card can exist on fewer.
    expect(tiers).toContain(`a minimum of ${MIN_GAMES_FOR_TIER} games played`);
  });

  it('names the pack tier a wildcard can actually fall out of', async () => {
    const user = userEvent.setup();
    renderTour();
    const wildcard = await slideText(user, 'Wild Card');

    const lowest = WILDCARD_PACK_TIERS[WILDCARD_PACK_TIERS.length - 1];
    expect(wildcard).toContain(`Each ${TIER_LABEL[lowest]} or better pack`);
  });

  // Issue #54: the tour said nothing about the Sleeper bonuses, so the two
  // packs a member can earn from a finished week were a rule only the code
  // knew. Composed from BONUS_KINDS and the threshold, so a retuned or removed
  // bonus fails here rather than lying on the overview slide.
  it('states the Sleeper bonuses the game actually awards', async () => {
    const user = userEvent.setup();
    renderTour();
    const overview = await slideText(user, SLIDES[0]);

    expect(overview).toContain('Win your matchup');
    expect(overview).toContain(`score over ${HIGH_SCORE_THRESHOLD} points`);
    // "Any" is the rule: winning in four Sleeper leagues is still one pack.
    expect(overview).toContain('in any of your Sleeper leagues');
    // The bonuses are independent — a week that does both is worth one pack
    // for each, which is what "each" says and "both" would not.
    expect(overview).toContain('each earns an extra pack');
    expect(BONUS_KINDS).toHaveLength(2);
  });

  it('states the portrait reward cap from the constant that enforces it', async () => {
    const user = userEvent.setup();
    renderTour();
    const customize = await slideText(user, 'Customize your deck.');

    expect(customize).toContain(`(limit ${MAX_CUSTOMIZATION_PACKS})`);
    // The pack is for giving a faceless card a face — isUnillustrated tests the
    // pool's own headshot, so replacing an existing photo earns nothing.
    expect(customize).toContain("players that don't have a photo");
  });

  it('states the deadlines the clock actually enforces', async () => {
    const user = userEvent.setup();
    renderTour();
    const lineup = await slideText(user, 'Lineup');

    expect(lineup).toContain(
      `Submit it by ${LOCK_DAY_LABEL} @ ${clockLabel(LOCK_HOUR, LOCK_MINUTE)} ${GAME_TIME_ZONE_LABEL} time`,
    );
    expect(lineup).toContain(
      `View the league results on ${REVEAL_DAY_LABEL} @ ${clockLabel(REVEAL_HOUR)} ${GAME_TIME_ZONE_LABEL} time`,
    );
  });
});
