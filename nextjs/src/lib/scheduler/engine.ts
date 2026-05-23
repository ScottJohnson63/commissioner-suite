// src/lib/scheduler/engine.ts

import "dotenv/config"
import { Team, Matchup, WeeklySlot, Schedule, ScheduleError } from './types';

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
    }
  }

  // Unreachable, but satisfies TypeScript's control flow analysis
  throw new ScheduleError('Unreachable');
}

function partitionByDivision(teams: Team[]): [Team[], Team[]] {
  const div0 = teams.filter((t) => t.divisionId === 0);
  const div1 = teams.filter((t) => t.divisionId === 1);
  if (div0.length !== 5 || div1.length !== 5) {
    throw new ScheduleError('Each division must have exactly 5 teams');
  }
  return [div0, div1];
}

// Round-robin within each division, played twice
function generateDivisionMatchups(divisions: [Team[], Team[]]): Matchup[] {
  const matchups: Matchup[] = [];
  for (const division of divisions) {
    const pairs = roundRobin(division);
    matchups.push(...pairs, ...pairs);
  }
  return matchups;
}

// Every team in div0 plays every team in div1 exactly once
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

// Standard round-robin: produces n*(n-1)/2 unique pairs
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

// Greedy slot-fill with consecutive-repeat guard.
// Shuffles matchups first so each generation produces variety.
function assignWeeks(matchups: Matchup[], totalWeeks: number): WeeklySlot[] {
  const weeks: WeeklySlot[] = Array.from({ length: totalWeeks }, (_, i) => ({
    week: i + 1,
    matchups: [],
  }));

  const shuffled = [...matchups].sort(() => Math.random() - 0.5);

  for (const matchup of shuffled) {
    const assigned = weeks.some((slot, weekIndex) => {
      // Reject if either team is already playing this week
      const busyTeams = new Set(slot.matchups.flatMap((m) => [m.home, m.away]));
      if (busyTeams.has(matchup.home) || busyTeams.has(matchup.away)) {
        return false;
      }

      // Reject if this exact pair played the week before or after
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

function matchupExistsInSlot(slot: WeeklySlot, matchup: Matchup): boolean {
  return slot.matchups.some(
    (m) =>
      (m.home === matchup.home && m.away === matchup.away) ||
      (m.home === matchup.away && m.away === matchup.home),
  );
}

function validateSchedule(schedule: Schedule, teams: Team[]): void {
  if (schedule.weeks.length !== 13) {
    throw new ScheduleError(
      `Expected 13 weeks, got ${schedule.weeks.length}`,
    );
  }

  // Each week must have exactly 5 matchups with all 10 teams playing
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

  // Each team must have exactly 13 games
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

  // No consecutive repeat matchups
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