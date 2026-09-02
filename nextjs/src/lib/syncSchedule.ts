// src/lib/syncSchedule.ts
//
// The one place that describes when external data is pulled in.
//
// The cron strings here must stay in step with `.github/workflows/*.yml` —
// that is where the jobs actually run. Duplicating them is deliberate: the UI
// needs to tell a commissioner when the next refresh lands without calling the
// GitHub API, and a schedule nobody can see is a schedule nobody trusts.
//
// GitHub Actions evaluates cron in UTC, so every calculation here is UTC too.

/** Mirrors the SyncSource enum in prisma/schema.prisma. */
export type SyncSource =
  | 'NFL_WEEKLY'
  | 'NFL_SEASON_RESET'
  | 'NFL_DEFENSE'
  | 'NFL_SCHEDULE'
  | 'SLEEPER_SCORES'
  | 'SLEEPER_RANKINGS'
  | 'SLEEPER_LEAGUES';

export interface SyncJob {
  source: SyncSource;
  label: string;
  /** What the job pulls, and from where. */
  description: string;
  /** Which external API it hits. */
  provider: 'nflverse' | 'Sleeper';
  /** UTC cron expression, or null for jobs that only ever run on demand. */
  cron: string | null;
  /** Plain-English restatement of `cron`, for the UI. */
  cadence: string;
  /** Workflow file under .github/workflows, or null if it runs in-process. */
  workflow: string | null;
  /**
   * True when the job's script exits early outside the NFL season. The cron
   * still fires year-round, so the UI has to say "will skip" rather than
   * promising data that is not coming.
   */
  seasonal: boolean;
  /**
   * Whether a manual dispatch should pass FORCE=true to bypass the job's date
   * guard. Off for the season reset: it truncates and reloads three seasons,
   * which is not something a stray button click should be able to do.
   */
  forceOnManualRun: boolean;
  /**
   * 'league' — the job reads per-league Sleeper data, so a manual run can be
   *            aimed at the league selected in the header.
   * 'global' — the job pulls NFL-wide data from nflverse. It is the same data
   *            for every league, so scoping it to one would be meaningless and
   *            the UI says so rather than offering a choice that does nothing.
   */
  scope: 'league' | 'global';
}

// Mirrors python/scripts/common/season.py — August 1 through February 1.
const SEASON_START_MONTH = 8;
const SEASON_END_MONTH = 2;
const SEASON_END_DAY = 1;

/**
 * Midnight UTC on the next August 1 strictly after `from`.
 *
 * The instant a dormant seasonal job wakes up: the crons fire year-round, and
 * the scripts' own `is_in_season` guard is what turns them back on.
 */
export function nextSeasonStart(from: Date = new Date()): Date {
  const thisYear = Date.UTC(from.getUTCFullYear(), SEASON_START_MONTH - 1, 1);
  return new Date(
    thisYear > from.getTime()
      ? thisYear
      : Date.UTC(from.getUTCFullYear() + 1, SEASON_START_MONTH - 1, 1),
  );
}

/** True between August 1 and February 1 inclusive, in UTC. */
export function isInSeason(date: Date = new Date()): boolean {
  const month = date.getUTCMonth() + 1;
  if (month >= SEASON_START_MONTH) return true;
  if (month < SEASON_END_MONTH) return true;
  return month === SEASON_END_MONTH && date.getUTCDate() <= SEASON_END_DAY;
}

export const SYNC_JOBS: SyncJob[] = [
  {
    source: 'NFL_WEEKLY',
    label: 'NFL Weekly Stats',
    description: 'Player box scores for the most recently completed week.',
    provider: 'nflverse',
    cron: '0 8 * * 2',
    cadence: 'Tuesdays at 08:00 UTC, during the season',
    workflow: 'sync_nfl_weekly.yml',
    forceOnManualRun: true,
    seasonal: true,
    scope: 'global',
  },
  {
    source: 'NFL_DEFENSE',
    label: 'NFL Team Defenses',
    description:
      'Team-defense box scores. Assembled rather than fetched: nflverse has no '
      + 'DEF position, so these come from the team feed, the schedule and the '
      + 'opposing offence.',
    provider: 'nflverse',
    cron: '15 8 * * 2',
    cadence: 'Tuesdays at 08:15 UTC, during the season',
    workflow: 'sync_nfl_defense.yml',
    forceOnManualRun: true,
    seasonal: true,
    scope: 'global',
  },
  {
    source: 'NFL_SCHEDULE',
    label: 'NFL Fixtures',
    description:
      'Who plays whom each week, where, and at what time. Feeds the matchup '
      + 'context panel: weather at the right venue, the opposing defense, and '
      + 'the game\'s betting line.',
    provider: 'nflverse',
    cron: '30 8 * * 2',
    cadence: 'Tuesdays at 08:30 UTC, during the season',
    workflow: 'sync_nfl_schedule.yml',
    forceOnManualRun: true,
    seasonal: true,
    scope: 'global',
  },
  {
    source: 'SLEEPER_SCORES',
    label: 'Sleeper Scores',
    description: 'Final matchup points for the completed week.',
    provider: 'Sleeper',
    cron: '30 8 * * 2',
    cadence: 'Tuesdays at 08:30 UTC, during the season',
    workflow: 'sync_sleeper_scores.yml',
    forceOnManualRun: true,
    seasonal: true,
    scope: 'league',
  },
  {
    // The source value stays NFL_SEASON_RESET because it is stored on every
    // historical SyncRun row; the job itself no longer resets anything.
    source: 'NFL_SEASON_RESET',
    label: 'NFL Annual Season Load',
    description:
      'Adds the season that just finished, in full and corrected. Nothing is deleted. Only runs on August 1st.',
    provider: 'nflverse',
    cron: '0 8 1 8 *',
    cadence: 'August 1st at 08:00 UTC',
    // Workflow filename kept as-is: renaming it would lose the run history
    // GitHub keys by file path. Its display name and step were updated.
    workflow: 'nfl_season_reset.yml',
    forceOnManualRun: false,
    seasonal: false,
    scope: 'global',
  },
  {
    source: 'SLEEPER_RANKINGS',
    label: 'Sleeper All-Time Rankings',
    description: 'Walks each league back through its prior seasons.',
    provider: 'Sleeper',
    cron: '0 9 1 9 *',
    cadence: 'September 1st at 09:00 UTC',
    workflow: 'sync_sleeper_rankings.yml',
    forceOnManualRun: false,
    seasonal: false,
    scope: 'league',
  },
  {
    source: 'SLEEPER_LEAGUES',
    label: 'League & Rosters',
    description: 'League settings, teams, and division assignments.',
    provider: 'Sleeper',
    cron: null,
    cadence: 'On demand',
    workflow: null,
    forceOnManualRun: false,
    seasonal: false,
    scope: 'league',
  },
];

export function jobFor(source: string): SyncJob | undefined {
  return SYNC_JOBS.find((j) => j.source === source);
}

/** A parsed cron field: the set of allowed values, or null meaning "any". */
type Field = Set<number> | null;

interface Cron {
  minute: Field;
  hour: Field;
  dayOfMonth: Field;
  month: Field;
  dayOfWeek: Field;
}

function parseField(raw: string, min: number, max: number): Field {
  if (raw === '*') return null;
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`Unsupported cron field "${raw}"`);
    }
    values.add(n);
  }
  return values;
}

/**
 * Parses the subset of cron syntax the workflows actually use: `*`, a literal
 * number, or a comma-separated list. Ranges and steps throw rather than being
 * silently mis-evaluated into a wrong "next run" time.
 */
export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Expected 5 cron fields, got "${expr}"`);
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function matches(field: Field, value: number): boolean {
  return field === null || field.has(value);
}

function dayMatches(cron: Cron, date: Date): boolean {
  if (!matches(cron.month, date.getUTCMonth() + 1)) return false;
  // Cron's quirk: when both day fields are restricted, either one matching is
  // enough. None of our jobs rely on it, but getting it wrong would silently
  // shift a displayed date.
  const dom = matches(cron.dayOfMonth, date.getUTCDate());
  const dow = matches(cron.dayOfWeek, date.getUTCDay());
  if (cron.dayOfMonth !== null && cron.dayOfWeek !== null) return dom || dow;
  return dom && dow;
}

/** Every minute-of-day the expression fires, ascending. */
function minutesOfDay(cron: Cron): number[] {
  const hours = cron.hour ? [...cron.hour].sort((a, b) => a - b) : range(0, 23);
  const minutes = cron.minute ? [...cron.minute].sort((a, b) => a - b) : range(0, 59);
  const out: number[] = [];
  for (const h of hours) for (const m of minutes) out.push(h * 60 + m);
  return out.sort((a, b) => a - b);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * The next UTC instant at or after `from` that `expr` fires.
 *
 * Scans forward a day at a time, so a once-a-year cron costs a few hundred
 * cheap iterations rather than half a million minute-by-minute ones. Returns
 * null if nothing matches within two years, which for these expressions means
 * the cron is unsatisfiable (e.g. February 30th).
 */
export function nextRun(expr: string, from: Date = new Date()): Date | null {
  const cron = parseCron(expr);
  const fires = minutesOfDay(cron);
  const fromMinute = from.getUTCHours() * 60 + from.getUTCMinutes();

  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));

  for (let i = 0; i < 366 * 2; i++) {
    if (dayMatches(cron, day)) {
      // Only the first day considered is partially elapsed.
      const earliest = i === 0 ? fires.find((m) => m > fromMinute) : fires[0];
      if (earliest !== undefined) {
        return new Date(day.getTime() + earliest * 60_000);
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return null;
}

/**
 * The most recent UTC instant strictly before `from` that `expr` fired.
 *
 * The mirror of nextRun, and the basis for noticing a job that did not run:
 * if the last recorded SyncRun predates this instant, the schedule came round
 * and nothing happened. Scans backwards a day at a time for the same reason
 * nextRun scans forwards.
 */
export function previousRun(expr: string, from: Date = new Date()): Date | null {
  const cron = parseCron(expr);
  const fires = minutesOfDay(cron);
  const fromMinute = from.getUTCHours() * 60 + from.getUTCMinutes();

  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));

  for (let i = 0; i < 366 * 2; i++) {
    if (dayMatches(cron, day)) {
      // Only today is partially elapsed; earlier days count in full.
      const candidates = i === 0 ? fires.filter((m) => m < fromMinute) : fires;
      const latest = candidates[candidates.length - 1];
      if (latest !== undefined) {
        return new Date(day.getTime() + latest * 60_000);
      }
    }
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return null;
}

/**
 * The next firing of `expr` that will actually do work rather than skip.
 *
 * For a seasonal job in the offseason, every cron firing between now and
 * August 1 writes a SKIPPED row and exits. This is the date to show a
 * commissioner who wants to know when the feed comes back, rather than a "next
 * run" that is technically true and practically useless.
 *
 * Returns nextRun unchanged for a job that is not seasonal, or one whose next
 * firing already lands in season.
 */
export function nextActiveRun(
  expr: string,
  seasonal: boolean,
  from: Date = new Date(),
): Date | null {
  const next = nextRun(expr, from);
  if (!seasonal || next === null || isInSeason(next)) return next;
  return nextRun(expr, nextSeasonStart(from));
}

/**
 * Grace period before a missing run is called overdue.
 *
 * GitHub's scheduler is best-effort and runs late under load — worst at the top
 * of the hour, which is when all of these fire. Six hours is not paranoia: this
 * repo's own history shows an 08:00 cron landing at 08:35, 08:54 and 10:38 on
 * consecutive weeks. Anything tighter would cry wolf on a normal busy morning,
 * and these jobs run weekly or yearly, so a few hours of slack costs nothing.
 */
export const OVERDUE_GRACE_MS = 6 * 60 * 60 * 1000;
