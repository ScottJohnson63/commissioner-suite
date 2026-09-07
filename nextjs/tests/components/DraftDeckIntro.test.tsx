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
import { numberWord } from '@/components/intro/draftDeckSlides';
import {
  CARDS_PER_PACK, ELIGIBLE_POSITIONS, PACK_GUARANTEE, POSITION_LABEL,
  TIER_LABEL, TIER_MAX_RANK, TIER_ORDER, WILDCARD_PULL_CHANCE,
} from '@/lib/cards/tiers';
import {
  FIRST_RATION_WEEK, GUARANTEED_GOLD_PACKS, HIGH_SCORE_THRESHOLD,
  PACKS_PER_WEEK, STARTER_GUARANTEED_GOLD, STARTER_PACKS, WILDCARD_SIDES,
} from '@/lib/cards/ration';
import { ROSTER_SIZE, lineupShape } from '@/lib/cards/roster';
import {
  GAME_TIME_ZONE_LABEL, LOCK_DAY_LABEL, LOCK_HOUR, LOCK_MINUTE, MAX_GAME_WEEK,
  REVEAL_DAY_LABEL, REVEAL_HOUR, clockLabel,
} from '@/lib/cards/weeklyGame';

function renderTour(isCommissioner = false) {
  return render(<DraftDeckIntro isCommissioner={isCommissioner} />);
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
    expect(screen.getByText('A card game on top of your league')).toBeTruthy();
  });

  it('pages forward and back, and closes on the last slide', async () => {
    const user = userEvent.setup();
    renderTour();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Tiers come from real season finishes')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('A card game on top of your league')).toBeTruthy();

    // Straight to the end, then out. Five clicks: overview, tiers, packs, deck,
    // lineup, then the closing slide.
    for (let i = 0; i < 5; i++) {
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
    expect(screen.getByText('1 / 6')).toBeTruthy();
    expect(screen.queryByText('Commissioner')).toBeNull();
    member.unmount();
    window.localStorage.clear();

    renderTour(true);
    expect(screen.getByText('1 / 7')).toBeTruthy();
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    expect(screen.getByRole('heading', { name: 'Commissioner' })).toBeTruthy();
  });
});

// Every expectation here is composed from the constant the game reads at
// runtime. None of them restates a number, which is the point: a test that
// hard coded "two packs a week" would have gone stale beside the slide it was
// supposed to be guarding.
describe('DraftDeckIntro — the rules it states', () => {
  it('describes the weekly ration the game actually pays', async () => {
    const user = userEvent.setup();
    renderTour();
    const packs = await slideText(user, 'Packs');

    expect(packs).toContain(
      `${numberWord(PACKS_PER_WEEK)} packs a week from week ${FIRST_RATION_WEEK} on`,
    );

    // The regression itself. A ration guarantee is a promise the pity timer
    // has to keep, so the slide may only make it while there is a quota to
    // deliver it — see GUARANTEED_GOLD_PACKS and mustForceGold.
    if (GUARANTEED_GOLD_PACKS > 0) {
      expect(packs).toContain(
        `${numberWord(GUARANTEED_GOLD_PACKS)} of them`,
      );
    } else {
      expect(packs).toContain('the ration promises you a pack, not a tier');
    }
  });

  it('states the starter grant, which is the one supply that promises a tier', async () => {
    const user = userEvent.setup();
    renderTour();
    const packs = await slideText(user, 'Packs');

    expect(packs).toContain(
      `${numberWord(STARTER_PACKS)} packs the first time you open the game`,
    );
    expect(packs).toContain(
      `${numberWord(STARTER_GUARANTEED_GOLD)} of them guaranteed Gold or better`,
    );
    // Week 1 pays no ration at all — packsForWeek returns 0 below
    // FIRST_RATION_WEEK — so the grant is a first sitting, not week 1's wage.
    expect(packs).toContain('Week 1 pays no ration at all');
  });

  it('states the bonus threshold and the wildcard die from their constants', async () => {
    const user = userEvent.setup();
    renderTour();
    const packs = await slideText(user, 'Packs');

    expect(packs).toContain(`score more than ${HIGH_SCORE_THRESHOLD} in one`);
    expect(packs).toContain(`pack in ${Math.round(1 / WILDCARD_PULL_CHANCE)} hides a die`);
    expect(packs).toContain(`one to ${numberWord(WILDCARD_SIDES)} extra packs`);
  });

  // openPack fills every slot the guarantee does not cover from *strictly
  // lower* tiers, so the tier on the wrapper is the best card in the pack. The
  // slide used to call it a floor, which says the exact opposite.
  it("describes a pack's tier as its ceiling rather than its floor", async () => {
    const user = userEvent.setup();
    renderTour();
    const packs = await slideText(user, 'Packs');

    expect(packs).toContain(`${numberWord(CARDS_PER_PACK)} cards a pack`);
    expect(packs).toContain('not a floor under the rest');
    expect(packs).toContain('drawn from the tiers below it');
    expect(packs).not.toContain('sets the floor');

    for (const tier of TIER_ORDER) {
      // Bronze guarantees the whole pack and has no filler, so it earns no
      // clause of its own.
      if (PACK_GUARANTEE[tier] >= CARDS_PER_PACK) continue;
      expect(packs).toContain(
        `a ${TIER_LABEL[tier]} pack ${tier === TIER_ORDER[0] ? 'holds ' : ''}` +
        `${numberWord(PACK_GUARANTEE[tier])}`,
      );
    }
  });

  it('states the tier bands, in words and in the artwork, from TIER_MAX_RANK', async () => {
    const user = userEvent.setup();
    renderTour();
    const tiers = await slideText(user, 'Tiers come from real season finishes');

    let floor = 1;
    for (const tier of TIER_ORDER) {
      const max = TIER_MAX_RANK[tier as keyof typeof TIER_MAX_RANK] as number | undefined;
      if (max === undefined) {
        expect(tiers).toContain(`${TIER_LABEL[tier]} — everybody else`);
        expect(tiers).toContain(`${floor}+`);            // the artwork's open band
      } else {
        expect(tiers).toContain(`${TIER_LABEL[tier]} — through rank ${max}`);
        expect(tiers).toContain(`${floor}\u2013${max}`);  // the artwork's closed band
        floor = max + 1;
      }
    }

    // The artwork used to letter each tier with an invented point value, on the
    // slide that exists to say a tier is not worth points. Nothing scores a
    // card by its tier.
    expect(tiers).toContain('A tier is not itself worth points');
    expect(tiers).not.toContain('pts');
  });

  it('names exactly the positions that get a card', async () => {
    const user = userEvent.setup();
    renderTour();
    const tiers = await slideText(user, 'Tiers come from real season finishes');

    for (const position of ELIGIBLE_POSITIONS) {
      expect(tiers).toContain(POSITION_LABEL[position]);
    }
    expect(tiers).toContain('Kickers and team defenses do not');
  });

  it('states the deadlines the clock actually enforces', async () => {
    const user = userEvent.setup();
    renderTour();
    const lineup = await slideText(user, 'Lineup — the week');

    expect(lineup).toContain(
      `Submit by ${LOCK_DAY_LABEL} ${clockLabel(LOCK_HOUR, LOCK_MINUTE)} ${GAME_TIME_ZONE_LABEL}`,
    );
    expect(lineup).toContain(
      `Results at ${REVEAL_DAY_LABEL} ${clockLabel(REVEAL_HOUR)} ${GAME_TIME_ZONE_LABEL}`,
    );
    expect(lineup).toContain(`${MAX_GAME_WEEK} weeks`);
  });

  it('describes the lineup the roster module defines', async () => {
    const user = userEvent.setup();
    renderTour();
    const lineup = await slideText(user, 'Lineup — the week');

    expect(lineup).toContain(`Fill the ${ROSTER_SIZE} slots`);
    for (const group of lineupShape()) {
      expect(lineup).toContain(`${numberWord(group.count)} ${group.label}`);
    }
  });
});
