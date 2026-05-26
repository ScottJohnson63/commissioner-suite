// src/lib/scheduler/types.ts
//
// Domain types shared between the schedule engine and the schedule API route.
//
// The scheduler is designed for a 10-team, 2-division, 13-week regular season.
// These types encode that invariant: WeeklySlot always holds exactly 5 matchups,
// and Team.divisionId is constrained to 0 | 1.

/** Opaque team identifier — matches the `id` primary key in the Team table. */
export type TeamId = string;

/** A single team in the league, as consumed by the schedule engine. */
export interface Team {
  /** Database primary key (matches `prisma.team.id`). */
  id: TeamId;
  /** Display name (used only for logging and error messages in the engine). */
  name: string;
  /** 0-indexed division membership. Division 0 = "East", Division 1 = "West" (by convention). */
  divisionId: 0 | 1;
}

/** A single game between two teams. */
export interface Matchup {
  /** ID of the home team. */
  home: TeamId;
  /** ID of the away team. */
  away: TeamId;
  /**
   * Matchup category used for schedule display and analytics.
   * - `division`       — both teams share the same divisionId.
   * - `cross-division` — teams are in opposite divisions.
   */
  type: 'division' | 'cross-division';
}

/** All matchups scheduled for a single week. */
export interface WeeklySlot {
  /** 1-indexed week number within the regular season (1–13). */
  week: number;
  /** Exactly 5 matchups, one per pair of the 10 teams. */
  matchups: Matchup[];
}

/** A fully generated and validated regular-season schedule. */
export interface Schedule {
  /** Internal league ID (matches `prisma.league.id`). */
  leagueId: string;
  /** NFL season year (e.g. 2025). */
  season: number;
  /** Ordered array of 13 weekly slots covering the entire regular season. */
  weeks: WeeklySlot[];
  /** UTC timestamp captured when the schedule was generated. */
  generatedAt: Date;
}

/**
 * Thrown by the schedule engine when it cannot produce a valid schedule.
 *
 * Catching `ScheduleError` specifically (rather than generic `Error`) allows
 * route handlers to distinguish engine failures from unexpected runtime errors
 * and return a more helpful 400/422 status instead of a 500.
 */
export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}