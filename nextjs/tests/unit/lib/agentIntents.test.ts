// tests/unit/lib/agentIntents.test.ts
//
// The six openers and the plans they resolve to.
//
// The page shows these strings; the route recognises them and answers without a
// classification call. That saves ~870 tokens and a request per question on the
// most-travelled path in the app — and it is only safe while the two agree, so
// what is pinned here is the agreement and the exactness of the match.

import { describe, it, expect } from '@jest/globals';

import {
  SUGGESTED_PROMPTS, VALID_INTENTS, emptyPlan, plannerShortcut,
} from '@/lib/agentIntents';

describe('SUGGESTED_PROMPTS', () => {
  // WHY: An opener whose intent the route does not recognise would be validated
  //      away to `general`, which fetches no panels — the button would quietly
  //      stop working while still looking fine.
  it('every opener carries an intent the route accepts', () => {
    for (const { text, plan } of SUGGESTED_PROMPTS) {
      expect(VALID_INTENTS).toContain(plan.intent);
      expect(text.trim()).toBe(text);
    }
  });

  // WHY: Two buttons with the same text would be one button as far as the
  //      shortcut map is concerned, and the second plan would be unreachable.
  it('has no duplicate text', () => {
    const seen = new Set(SUGGESTED_PROMPTS.map((p) => p.text.toLowerCase()));
    expect(seen.size).toBe(SUGGESTED_PROMPTS.length);
  });
});

describe('plannerShortcut', () => {
  // WHY: A clicked opener arrives byte-identical. This is the saving.
  it('resolves every opener without a model call', () => {
    for (const { text, plan } of SUGGESTED_PROMPTS) {
      expect(plannerShortcut(text)).toEqual(plan);
    }
  });

  // WHY: The reader who types one out, or pastes it back with a full stop, gets
  //      the same answer as the one who clicked it.
  it('ignores casing, surrounding space and trailing punctuation', () => {
    const { text, plan } = SUGGESTED_PROMPTS[0];
    expect(plannerShortcut(`  ${text.toUpperCase()}  `)).toEqual(plan);
    expect(plannerShortcut(text.replace(/\?$/, ''))).toEqual(plan);
    expect(plannerShortcut(`${text}!!`)).toEqual(plan);
  });

  // WHY: A question that differs by a word is a different question. Guessing
  //      its intent to save a call would put the wrong data in front of the
  //      model, which costs more than the call it saved.
  it('does not match a question that only resembles an opener', () => {
    expect(plannerShortcut('Who should I start at quarterback?')).toBeNull();
    expect(plannerShortcut('How does my matchup look next week?')).toBeNull();
    expect(plannerShortcut('matchup')).toBeNull();
    expect(plannerShortcut('')).toBeNull();
  });

  // WHY: The route mutates the plan it gets back (it fills in defaults per
  //      intent). Handing out the shared object would let one request's
  //      defaults leak into every later request that clicked the same button.
  it('returns a fresh plan each time, not the shared one', () => {
    const first = plannerShortcut(SUGGESTED_PROMPTS[0].text);
    expect(first).not.toBeNull();
    first!.position = 'QB';
    expect(plannerShortcut(SUGGESTED_PROMPTS[0].text)?.position).toBeNull();
  });
});

describe('emptyPlan', () => {
  // WHY: Every field the route reads has to exist, or a plan built here behaves
  //      differently from one the planner returned.
  it('fills in every field a planner-built plan would have', () => {
    expect(emptyPlan('trending')).toEqual({
      intent: 'trending', players: [], position: null, opponent: null, season: null, weeksBack: null,
    });
    expect(emptyPlan().intent).toBe('general');
  });
});
