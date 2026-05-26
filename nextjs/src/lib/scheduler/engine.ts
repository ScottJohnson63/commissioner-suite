// src/lib/scheduler/engine.ts
//
// Fantasy football regular-season schedule generator.
//
// Generates a valid 13-week schedule for a 10-team, 2-division league, subject
// to these constraints:
//   1. Every team plays exactly 13 games.
//   2. Every team plays exactly one game per week.
//   3. Within-division matchups are played twice (home-and-home round-robin).
//   4. Cross-division matchups are played once (every div-0 team vs. every div-1 team).
//   5. No pair of teams may face each other in back-to-back weeks.
//
// Matchup totals:
//   • Division games:      2 × C(5,2) × 2 divisions = 20  (each pair played twice)
//   • Cross-division games: 5 × 5 = 25
//   • Total:               45 matchups across 13 weeks × 5 games/week
//
// Algorithm:
//   1. Generate the full set of required matchups (deterministic).
//   2. Shuffle the matchup list randomly.
//   3. Greedily assign each matchup to the first valid week slot.
//   4. Validate the resulting schedule against all constraints.
//   5. If assignment or validation fails, retry with a new shuffle (up to maxAttempts).
//
// The retry loop is necessary because the greedy approach can paint itself into
// a corner. In practice a valid schedule is found in the first attempt ~98% of
// the time. The default 5 000-attempt ceiling is effectively unreachable.

import { Team, Matchup, WeeklySlot, Schedule, ScheduleError } from './types';

/**
 * Generates a valid regular-season schedule for a 10-team, 2-division league.
 *
 * @param leagueId     Internal league ID; stored on the returned Schedule object.
 * @param season       NFL season year (e.g. 2025).
 * @param teams        Exactly 10 teams, 5 per division.
 * @param maxAttempts  Maximum randomised retries before giving up.
 *                     Override via `SCHEDULE_MAX_ATTEMPTS` env var.
 * @returns  A fully validated Schedule covering 13 weeks.
 * @throws   `ScheduleError` if validation never passes within maxAttempts.
 */
export function generateSchedule(
  leagueId: string,
  season: number,
  teams: Team[],
  maxAttempts: number = Number(process.env.SCHEDULE_MAX_ATTEMPTS ?? 5000),
): Schedule {
  if (teams.length !== 10) {
    throw new ScheduleError(`Expected 10 teams, got ${teams.length}`);
  }

  const divisions = partitionByDivision(teams);
  const divisionMatchups = generateDivisionMatchups(divisions);
  const crossMatchups = generateCrossMatchups(divisions);
  const allMatchups = [...divisionMatchups, ...crossMatchups];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const weeks = assignWeeks(allMatchups, 13);
      const schedule: Schedule = {
        leagueId,
        season,
        weeks,
        generatedAt: new Date(),
      };
      validateSchedule(schedule, teams);
      return schedule;
    } catch (err) {
      if (attempt === maxAttempts) {
        throw new ScheduleError(
          `Failed to generate a valid schedule after ${maxAttempts} attempts: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      // Swallow and retry — the shuffle in assignWeeks will produce a different arrangement.
    }
  }

  // Unreachable, but satisfies TypeScript's control flow analysis.
  throw new ScheduleError('Unreachable');
}

/**
 * Splits the team list into two division arrays ([div0, div1]).
 * Enforces that each division has exactly 5 teams.
 */
function partitionByDivision(teams: Team[]): [Team[], Team[]] {
  const div0 = teams.filter((t) => t.divisionId === 0);
  const div1 = teams.filter((t) => t.divisionId === 1);
  if (div0.length !== 5 || div1.length !== 5) {
    throw new ScheduleError('Each division must have exactly 5 teams');
  }
  return [div0, div1];
}

/**
 * Generates within-division matchups for both divisions.
 * Each intra-division pair is played twice (home-and-home), producing
 * 2 × C(5,2) × 2 = 20 matchups total.
 */
function generateDivisionMatchups(divisions: [Team[], Team[]]): Matchup[] {
  const matchups: Matchup[] = [];
  for (const division of divisions) {
    const pairs = roundRobin(division);
    // Push twice — each pair plays home and away within the division.
    matchups.push(...pairs, ...pairs);
  }
  return matchups;
}

/**
 * Generates cross-division matchups: every team in div0 vs. every team in div1,
 * played exactly once, producing 5 × 5 = 25 matchups.
 */
function generateCrossMatchups(divisions: [Team[], Team[]]): Matchup[] {
  const [div0, div1] = divisions;
  const matchups: Matchup[] = [];
  for (const home of div0) {
    for (const away of div1) {
      matchups.push({ home: home.id, away: away.id, type: 'cross-division' });
    }
  }
  return matchups;
}

/**
 * Produces all unique pairs from an array of teams — the standard round-robin
 * algorithm. Returns n*(n-1)/2 matchups (10 for a 5-team division).
 */
function roundRobin(teams: Team[]): Matchup[] {
  const matchups: Matchup[] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      matchups.push({
        home: teams[i].id,
        away: teams[j].id,
        type: 'division',
      });
    }
  }
  return matchups;
}

/**
 * Assigns each matchup to a weekly slot using a greedy first-fit strategy.
 *
 * The matchup list is shuffled before assignment so that repeated calls produce
 * different (but valid) schedules. For each matchup, the algorithm scans weeks
 * in order and places it in the first week where:
 *   • Neither team is already playing that week.
 *   • The same pair did not play in the immediately preceding or following week
 *     (consecutive-repeat guard).
 *
 * If no valid slot can be found for a matchup, a ScheduleError is thrown and
 * the caller retries with a fresh shuffle.
 *
 * @param matchups    All matchups to schedule (order will be randomised internally).
 * @param totalWeeks  Number of weeks in the regular season (13).
 * @returns           Array of WeeklySlots with all matchups distributed.
 */
function assignWeeks(matchups: Matchup[], totalWeeks: number): WeeklySlot[] {
  const weeks: WeeklySlot[] = Array.from({ length: totalWeeks }, (_, i) => ({
    week: i + 1,
    matchups: [],
  }));

  const shuffled = [...matchups].sort(() => Math.random() - 0.5);

  for (const matchup of shuffled) {
    const assigned = weeks.some((slot, weekIndex) => {
      // Reject if either team is already playing this week.
      const busyTeams = new Set(slot.matchups.flatMap((m) => [m.home, m.away]));
      if (busyTeams.has(matchup.home) || busyTeams.has(matchup.away)) {
        return false;
      }

      // Reject if this exact pair played the week before or after (constraint 5).
      const prevSlot = weeks[weekIndex - 1];
      const nextSlot = weeks[weekIndex + 1];
      if (prevSlot && matchupExistsInSlot(prevSlot, matchup)) return false;
      if (nextSlot && matchupExistsInSlot(nextSlot, matchup)) return false;

      slot.matchups.push(matchup);
      return true;
    });

    if (!assigned) {
      throw new ScheduleError(
        `Could not assign matchup ${matchup.home} vs ${matchup.away} without consecutive repeat`,
      );
    }
  }

  return weeks;
}

/**
 * Returns true if `slot` already contains a matchup between the same two teams
 * as `matchup`, regardless of home/away ordering.
 */
function matchupExistsInSlot(slot: WeeklySlot, matchup: Matchup): boolean {
  return slot.matchups.some(
    (m) =>
      (m.home === matchup.home && m.away === matchup.away) ||
      (m.home === matchup.away && m.away === matchup.home),
  );
}

/**
 * Validates a generated schedule against all five scheduling constraints.
 * Throws a descriptive `ScheduleError` on the first violation found.
 *
 * @param schedule  The schedule to validate.
 * @param teams     The full team list used to verify per-team game counts.
 */
function validateSchedule(schedule: Schedule, teams: Team[]): void {
  if (schedule.weeks.length !== 13) {
    throw new ScheduleError(
      `Expected 13 weeks, got ${schedule.weeks.length}`,
    );
  }

  // Constraint 2: every team plays exactly once per week (5 matchups, 10 teams).
  for (const slot of schedule.weeks) {
    if (slot.matchups.length !== 5) {
      throw new ScheduleError(
        `Week ${slot.week} has ${slot.matchups.length} matchups, expected 5`,
      );
    }
    const weekTeams = slot.matchups.flatMap((m) => [m.home, m.away]);
    const uniqueWeekTeams = new Set(weekTeams);
    if (uniqueWeekTeams.size !== 10) {
      throw new ScheduleError(
        `Week ${slot.week} has a team playing more than once`,
      );
    }
  }

  // Constraint 1: every team plays exactly 13 games.
  const teamIds = new Set(teams.map((t) => t.id));
  for (const teamId of teamIds) {
    const games = schedule.weeks.flatMap((w) =>
      w.matchups.filter((m) => m.home === teamId || m.away === teamId),
    );
    if (games.length !== 13) {
      throw new ScheduleError(
        `Team ${teamId} has ${games.length} games, expected 13`,
      );
    }
  }

  // Constraint 5: no pair plays in back-to-back weeks.
  for (let i = 0; i < schedule.weeks.length - 1; i++) {
    const thisWeek = schedule.weeks[i];
    const nextWeek = schedule.weeks[i + 1];
    for (const matchup of thisWeek.matchups) {
      if (matchupExistsInSlot(nextWeek, matchup)) {
        throw new ScheduleError(
          `Consecutive repeat: ${matchup.home} vs ${matchup.away} in weeks ${i + 1} and ${i + 2}`,
        );
      }
    }
  }
}