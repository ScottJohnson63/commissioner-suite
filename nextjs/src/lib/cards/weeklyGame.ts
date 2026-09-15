// src/lib/cards/weeklyGame.ts
//
// The weekly submission game's clock: which week it is, when the lineup locks,
// and when the results come out.
//
// Draft Deck's season is now played a week at a time. A member sets a lineup and
// submits it before **Monday 11:59pm central**; the moment that deadline passes
// everybody's cards are laid out best to worst. The nine cards that played are
// retired, so the next week has to be fielded from what is left.
//
// ── Why the results publish at the deadline ─────────────────────────────────
//
// They used to wait until Tuesday 10am, and the ten hours in between were the
// bug in issue #95. A week's points are a frozen sum of `pointsPerGame` taken at
// submit time, not a live reading of Sunday's games — a member has already seen
// their own number on the submit button, so the wait only hid other people's.
// What it did instead was strand the week: the cards retired at the lock and the
// lineup emptied with them, while the scoreboard went on reporting nothing
// played, which ranked whoever had submitted *below* whoever had not. Publishing
// at the deadline closes the week in one instant.
//
// Everything in here is pure — no Prisma, no network, no `Date.now()` unless a
// caller passes one in. The deadlines are the rules of the game, so they have
// to be assertable in a test rather than observed in production on a Monday
// night.
//
// ── Why the week comes from the clock rather than from Sleeper ───────────────
//
// The rest of the card game asks Sleeper what week it is. That is right for a
// pack ration, which only has to land on the correct side of a Monday. It is
// wrong here: the lock and the reveal are wall-clock instants, so the week they
// belong to has to be derived from the same clock or the two can disagree — and
// they would, because Sleeper rolls its week over on its own schedule and
// nothing says that instant is this one.
//
// The anchor is Labor Day, which is all the NFL calendar a schedule needs: week
// 1 always kicks off the Thursday after it, so **week W's Monday night is Labor
// Day plus 7 × W days** — Labor Day 2025 was September 1st and week 1's Monday
// night game was September 8th. No feed, no table, no season-start constant to
// keep current.
//
// ── Central time, not UTC-6 ─────────────────────────────────────────────────
//
// "Central standard time" is read as the wall clock in Chicago, which is CDT
// for the first two months of the season and CST after early November. Pinning
// it to a fixed −6 would move the deadline to 12:59am for the half of the
// season nobody would expect it to. The offset is resolved per instant through
// Intl, so the deadline stays 11:59pm on the clock on the wall in every week.

/** The zone every deadline in this game is stated in. */
export const GAME_TIME_ZONE = 'America/Chicago';

/** The zone as a member reads it, for prose rather than for arithmetic. */
export const GAME_TIME_ZONE_LABEL = 'central';

/** Lineups lock at the end of Monday — 23:59:59.999 central. */
export const LOCK_HOUR = 23;
export const LOCK_MINUTE = 59;

/**
 * The weekday the deadline falls on, for prose.
 *
 * Not configurable and not arithmetic: lockDay is Labor Day plus whole weeks,
 * so it is always a Monday. Named here anyway so that the Draft Deck tour reads
 * its weekday from the module that decides it instead of asserting it from
 * memory — the same reason the hours above are exported. See issue #43.
 */
export const LOCK_DAY_LABEL = 'Monday';

/**
 * A deadline as a member would read it — "11:59pm", "12:00am".
 *
 * Minutes are always shown, including on the hour: "11:59pm" and "12am" side by
 * side read as though one were less exact than the other when both are to the
 * minute.
 */
export function clockLabel(hour: number, minute = 0): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')}${suffix}`;
}

/**
 * The last week the game is played.
 *
 * Eighteen, matching the NFL regular season the card pool is built from. Past
 * it there is nothing left to submit and the season's winner is settled.
 */
export const MAX_GAME_WEEK = 18;

/**
 * Where a week is in its cycle.
 *
 * Two states, not three. There used to be a `LOCKED` phase for the hours
 * between the deadline and the Tuesday publish; the publish now happens at the
 * deadline, so no instant falls between them and a third state could only ever
 * be unreachable. See issue #95.
 */
export type WeekPhase =
  /** Accepting submissions. */
  | 'OPEN'
  /** Past the Monday deadline: results are out. */
  | 'REVEALED';

/** One week of the game, and the three instants that bound it. */
export interface WeeklyWindow {
  week: number;
  /** When this week started accepting lineups — the previous week's reveal. */
  opensAt: Date;
  /** Monday 23:59:59.999 central. The submission deadline. */
  lockAt: Date;
  /** The millisecond after the lock. When the results appear. */
  revealAt: Date;
}

// ─── Central-time arithmetic ─────────────────────────────────────────────────

/**
 * One formatter, built once.
 *
 * `Intl.DateTimeFormat` is expensive to construct and this module builds
 * several dozen instants per request; the formatter itself is stateless, so
 * there is nothing to keep per call.
 */
const CENTRAL = new Intl.DateTimeFormat('en-US', {
  timeZone: GAME_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/**
 * Central's offset from UTC at one instant, in milliseconds.
 *
 * Read from the formatter rather than hard-coded, because the whole point is
 * that it changes: −5 hours until the first Sunday of November and −6 after it.
 */
function offsetMs(instant: Date): number {
  const parts = CENTRAL.formatToParts(instant);
  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    field('year'), field('month') - 1, field('day'),
    field('hour'), field('minute'), field('second'),
  );
  // The formatter has no milliseconds, so compare against the instant truncated
  // to the same resolution — otherwise every offset comes back a few hundred
  // milliseconds out and the two-pass correction below never settles.
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which a given central wall-clock time occurs.
 *
 * Two passes, which is what makes the days either side of a DST change come out
 * right: the first guess uses the offset in force at the *UTC* reading of the
 * wall clock, which is up to an hour off across a transition, and the second
 * uses the offset in force at the guess. Out-of-range day numbers are welcome —
 * `Date.UTC` normalises them, so "Labor Day plus 126 days" needs no calendar
 * arithmetic of its own.
 */
function centralInstant(
  year: number, month: number, day: number,
  hour: number, minute = 0, second = 0, ms = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const first = wall - offsetMs(new Date(wall));
  return new Date(wall - offsetMs(new Date(first)));
}

/**
 * The day of September that Labor Day — the first Monday — falls on.
 *
 * Computed with UTC accessors deliberately: this is civil-calendar arithmetic
 * about a date, not about an instant, and the local accessors would hand a
 * server running in Auckland a different answer.
 */
export function labourDay(season: number): number {
  const firstOfSeptember = new Date(Date.UTC(season, 8, 1)).getUTCDay();
  return 1 + ((8 - firstOfSeptember) % 7);
}

/**
 * The Monday that closes week `week`, as a civil date.
 *
 * Week 1's Monday is Labor Day plus seven days: the NFL opens on the Thursday
 * after Labor Day, so its first Monday night game is eleven days after the
 * first of the month at the earliest. Week 0 — Labor Day itself — is a real
 * answer here and is what week 1's opening bell is derived from.
 */
function lockDay(season: number, week: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(season, 8, labourDay(season) + 7 * week));
  return {
    year:  date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day:   date.getUTCDate(),
  };
}

/** Monday 23:59:59.999 central for one week. */
export function lockAt(season: number, week: number): Date {
  const { year, month, day } = lockDay(season, week);
  return centralInstant(year, month, day, LOCK_HOUR, LOCK_MINUTE, 59, 999);
}

/**
 * The instant one week's results are published: the millisecond after its lock.
 *
 * The one millisecond is not decoration. `phaseOf` treats the deadline as
 * **inclusive** — a lineup landing exactly on 23:59:59.999 is in — so a publish
 * at `lockAt` itself would leave a single millisecond during which the results
 * are readable *and* a lineup can still be submitted against them. One
 * millisecond later the two states abut with neither a gap nor an overlap.
 *
 * Which makes this Tuesday 00:00:00.000 central, and the reason it is written
 * as "the lock plus one" rather than as midnight is that the two must not be
 * able to drift apart: a change to the lock has to carry the publish with it.
 */
export function revealAt(season: number, week: number): Date {
  return new Date(lockAt(season, week).getTime() + 1);
}

// ─── Weeks ───────────────────────────────────────────────────────────────────

/**
 * One week's three instants.
 *
 * A week opens when the previous week's results are published, so the cycle has
 * no gap in it: the moment you see how last week went is the moment you can
 * start next week's lineup. Week 1 opens at "week 0"'s reveal — the millisecond
 * after Labor Day ends, three days before the season's first kickoff.
 */
export function windowForWeek(season: number, week: number): WeeklyWindow {
  return {
    week,
    opensAt:  revealAt(season, week - 1),
    lockAt:   lockAt(season, week),
    revealAt: revealAt(season, week),
  };
}

/**
 * Where a week is in its cycle at `now`.
 *
 * The boundary is inclusive of the deadline: a submission landing exactly on
 * 23:59:59.999 is in, and one a millisecond later is not — and that millisecond
 * later is also the instant the results come out, so every instant belongs to
 * exactly one of the two phases.
 */
export function phaseOf(window: WeeklyWindow, now: Date): WeekPhase {
  return now.getTime() <= window.lockAt.getTime() ? 'OPEN' : 'REVEALED';
}

/**
 * The week a lineup submitted `now` would belong to.
 *
 * The first week whose results are still to come — which is the week now being
 * played, right up to its deadline. Clamped to the season: before
 * September it is week 1, and once week 18's results are out it stays at 18
 * with `seasonOver` telling the caller there is nothing left to submit.
 */
export function currentWindow(season: number, now: Date): WeeklyWindow {
  for (let week = 1; week <= MAX_GAME_WEEK; week += 1) {
    const window = windowForWeek(season, week);
    if (now.getTime() < window.revealAt.getTime()) return window;
  }
  return windowForWeek(season, MAX_GAME_WEEK);
}

/** True once the last week's results are out and the season is decided. */
export function seasonOver(season: number, now: Date): boolean {
  return now.getTime() >= revealAt(season, MAX_GAME_WEEK).getTime();
}

/**
 * The most recent week whose results have been published, or null before the
 * season's first deadline has passed.
 */
export function lastRevealedWeek(season: number, now: Date): number | null {
  for (let week = MAX_GAME_WEEK; week >= 1; week -= 1) {
    if (now.getTime() >= revealAt(season, week).getTime()) return week;
  }
  return null;
}

/**
 * Every week whose results are out, oldest first.
 *
 * Used for the week picker on the results view, and to bound the season score:
 * points count from the moment the week's deadline passes, never before.
 */
export function revealedWeeks(season: number, now: Date): number[] {
  const last = lastRevealedWeek(season, now);
  if (last === null) return [];
  return Array.from({ length: last }, (_, i) => i + 1);
}

/**
 * The deadline as a person would read it — "Mon, Sep 8, 11:59 PM CDT".
 *
 * Stated in central whatever the reader's own zone is, because the deadline is
 * central: a member in Los Angeles needs to know it is 9:59pm for them, and the
 * way to tell them that is to name the zone the rule is written in.
 */
export function formatCentral(instant: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: GAME_TIME_ZONE,
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(instant);
}
