// tests/unit/lib/cards/weeklyGame.test.ts
//
// Covers src/lib/cards/weeklyGame.ts — the weekly game's clock.
//
// These deadlines *are* the rules: "submit before Monday 11:59pm central" and
// "results the moment that passes" are the whole feature, and the only place
// they can be checked without waiting for a Monday night is here.
//
// Three things are worth more than the rest. The anchor has to land on the
// right Monday in a season nobody has played yet; the boundary has to be exact
// to the millisecond, because a submission a millisecond late is refused; and
// the deadline has to stay at 11:59pm on the wall through the November change
// from CDT to CST, which is the case a fixed −6 offset would get wrong for
// two thirds of a season.

import { describe, it, expect } from '@jest/globals';
import {
  LOCK_HOUR, LOCK_MINUTE, MAX_GAME_WEEK, clockLabel, currentWindow,
  formatCentral, labourDay, lastRevealedWeek, lockAt, phaseOf, revealAt,
  revealedWeeks, seasonOver, windowForWeek,
} from '@/lib/cards/weeklyGame';

/** The wall clock in Chicago at an instant, for asserting on a deadline. */
function central(instant: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hourCycle: 'h23',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(instant);
}

describe('the season anchor', () => {
  // WHY: the whole calendar hangs off this. Labor Day is the first Monday of
  //      September, and the NFL always opens the Thursday after it.
  it('finds Labor Day in seasons that start on every weekday', () => {
    expect(labourDay(2025)).toBe(1);  // Sept 1 was itself a Monday
    expect(labourDay(2026)).toBe(7);  // Sept 1 a Tuesday — the long way round
    expect(labourDay(2027)).toBe(6);
    expect(labourDay(2029)).toBe(3);
  });

  // WHY: week 1's Monday night game is Labor Day plus a week. Getting this off
  //      by seven days would run the whole season a week early.
  it('locks week 1 on the Monday after Labor Day', () => {
    expect(central(lockAt(2025, 1))).toBe('Mon, Sep 8, 23:59 CDT');
    expect(central(lockAt(2026, 1))).toBe('Mon, Sep 14, 23:59 CDT');
  });

  it('runs eighteen weeks into the new year', () => {
    expect(central(lockAt(2025, MAX_GAME_WEEK))).toBe('Mon, Jan 5, 23:59 CST');
    expect(lockAt(2025, MAX_GAME_WEEK).getUTCFullYear()).toBe(2026);
  });
});

describe('the deadlines', () => {
  it('locks at 11:59pm Monday and publishes the millisecond after', () => {
    expect(central(lockAt(2025, 4))).toBe('Mon, Sep 29, 23:59 CDT');
    expect(central(revealAt(2025, 4))).toBe('Tue, Sep 30, 00:00 CDT');
    expect(revealAt(2025, 4).getTime() - lockAt(2025, 4).getTime()).toBe(1);
  });

  // WHY: issue #95. The publish used to be ten hours after the lock, and every
  //      instant in between reported a week whose cards had retired and whose
  //      score had not landed. No instant may fall between them now: one
  //      millisecond earlier is OPEN, and this one is already published.
  it('leaves no instant between the deadline and the publish', () => {
    for (const week of [1, 9, MAX_GAME_WEEK]) {
      const window = windowForWeek(2025, week);
      const lock = lockAt(2025, week);

      expect(phaseOf(window, lock)).toBe('OPEN');
      expect(phaseOf(window, new Date(lock.getTime() + 1))).toBe('REVEALED');
      expect(lastRevealedWeek(2025, lock)).not.toBe(week);
      expect(lastRevealedWeek(2025, new Date(lock.getTime() + 1))).toBe(week);
    }
  });

  // WHY: the reason the zone is resolved per instant rather than pinned to −6.
  //      Central goes from CDT to CST in early November, and a fixed offset
  //      would quietly move the deadline to 12:59am for the rest of the season.
  it('stays at 11:59pm on the wall across the November change', () => {
    expect(central(lockAt(2025, 9))).toBe('Mon, Nov 3, 23:59 CST');
    expect(central(lockAt(2025, 8))).toBe('Mon, Oct 27, 23:59 CDT');
    // Same wall clock, different UTC offset — which is the point.
    expect(lockAt(2025, 9).getTime() - lockAt(2025, 8).getTime())
      .toBe(7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
  });

  it('gives every week a full seven days', () => {
    for (let week = 2; week <= MAX_GAME_WEEK; week += 1) {
      expect(central(lockAt(2025, week)).startsWith('Mon')).toBe(true);
      // Midnight belongs to the Tuesday, one millisecond past the Monday.
      expect(central(revealAt(2025, week)).startsWith('Tue')).toBe(true);
    }
  });

  it('states the deadline in central whatever zone the reader is in', () => {
    expect(formatCentral(lockAt(2025, 1))).toBe('Mon, Sep 8, 11:59 PM CDT');
  });
});

describe('which week a submission belongs to', () => {
  const at = (iso: string) => new Date(iso);

  // WHY: a submission a millisecond late is refused, so the boundary has to be
  //      exact rather than approximately midnight.
  it('accepts the last millisecond and refuses the next one', () => {
    const lock = lockAt(2025, 1);
    const window = windowForWeek(2025, 1);

    expect(phaseOf(window, new Date(lock.getTime()))).toBe('OPEN');
    expect(phaseOf(window, new Date(lock.getTime() + 1))).toBe('REVEALED');
  });

  // WHY: the handover is a single instant, and the whole of issue #95 was that
  //      it used to be ten hours wide. Midnight closes week 1 and opens week 2
  //      in the same tick — nothing is ever between weeks.
  it('closes one week and opens the next in a single instant', () => {
    const monday = at('2025-09-09T04:58:00Z');    // 11:58pm CDT Monday
    const midnight = at('2025-09-09T05:00:00Z');  // 12:00am CDT Tuesday
    const laterTuesday = at('2025-09-09T15:00:00Z');

    expect(currentWindow(2025, monday).week).toBe(1);
    expect(phaseOf(currentWindow(2025, monday), monday)).toBe('OPEN');
    expect(lastRevealedWeek(2025, monday)).toBeNull();

    // Midnight: week 1 published, week 2 open, in one instant.
    for (const instant of [midnight, laterTuesday]) {
      expect(currentWindow(2025, instant).week).toBe(2);
      expect(phaseOf(currentWindow(2025, instant), instant)).toBe('OPEN');
      expect(lastRevealedWeek(2025, instant)).toBe(1);
    }
  });

  // WHY: a member opening the game in August should be shown week 1 rather than
  //      an error. There is simply nothing published yet.
  it('sits on week 1 before the season starts', () => {
    const august = at('2025-08-15T12:00:00Z');
    expect(currentWindow(2025, august).week).toBe(1);
    expect(phaseOf(currentWindow(2025, august), august)).toBe('OPEN');
    expect(lastRevealedWeek(2025, august)).toBeNull();
    expect(revealedWeeks(2025, august)).toEqual([]);
  });

  it('opens a week the moment the one before it is published', () => {
    const window = windowForWeek(2025, 5);
    expect(window.opensAt.getTime()).toBe(revealAt(2025, 4).getTime());
  });

  // WHY: past the last week there is nothing left to submit, and the season's
  //      winner is settled rather than still in play.
  it('ends the season after week 18 is published', () => {
    const during = at('2026-01-05T12:00:00Z');
    const after = at('2026-01-07T16:00:00Z');

    expect(seasonOver(2025, during)).toBe(false);
    expect(seasonOver(2025, after)).toBe(true);
    expect(currentWindow(2025, after).week).toBe(MAX_GAME_WEEK);
    expect(lastRevealedWeek(2025, after)).toBe(MAX_GAME_WEEK);
    expect(revealedWeeks(2025, after)).toHaveLength(MAX_GAME_WEEK);
  });

  it('lists published weeks oldest first', () => {
    // Wednesday of week 5 — weeks 1 to 4 have had their deadline.
    expect(revealedWeeks(2025, at('2025-10-01T16:00:00Z'))).toEqual([1, 2, 3, 4]);
    // Monday evening of week 4, before its deadline: only three are out.
    expect(revealedWeeks(2025, at('2025-09-30T02:00:00Z'))).toEqual([1, 2, 3]);
  });
});

// The Draft Deck tour states the deadline through this, so that "submit by
// Monday 11:59pm" is read off LOCK_HOUR rather than typed out — see issue #43.
describe('clockLabel', () => {
  it('states the real deadline the way a member reads it', () => {
    expect(clockLabel(LOCK_HOUR, LOCK_MINUTE)).toBe('11:59pm');
  });

  it('always shows minutes, pads them, and reads noon and midnight as 12', () => {
    expect(clockLabel(9, 0)).toBe('9:00am');
    expect(clockLabel(9, 5)).toBe('9:05am');
    expect(clockLabel(12)).toBe('12:00pm');
    expect(clockLabel(0)).toBe('12:00am');
    expect(clockLabel(0, 1)).toBe('12:01am');
    expect(clockLabel(13, 30)).toBe('1:30pm');
  });
});
