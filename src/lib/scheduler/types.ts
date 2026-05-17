// src/lib/scheduler/types.ts

export type TeamId = string;

export interface Team {
  id: TeamId;
  name: string;
  divisionId: 0 | 1;
}

export interface Matchup {
  home: TeamId;
  away: TeamId;
  type: 'division' | 'cross-division';
}

export interface WeeklySlot {
  week: number; // 1–13
  matchups: Matchup[]; // always exactly 5 matchups (10 teams / 2)
}

export interface Schedule {
  leagueId: string;
  season: number;
  weeks: WeeklySlot[];
  generatedAt: Date;
}

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}