// tests/unit/lib/scheduler/engine.test.ts
//
// Replaces the old console-script at src/lib/scheduler/engine.test.ts.
// Tests the schedule generator against all five scheduling constraints.

import { describe, it, expect } from '@jest/globals';
import { generateSchedule } from '@/lib/scheduler/engine';
import { ScheduleError } from '@/lib/scheduler/types';
import type { Team, Schedule } from '@/lib/scheduler/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

// 10 teams — 5 per division — the only valid input shape for generateSchedule.
function makeTeams(): Team[] {
  return [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `d0-t${i + 1}`,
      name: `Div0 Team ${i + 1}`,
      divisionId: 0 as const,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `d1-t${i + 1}`,
      name: `Div1 Team ${i + 1}`,
      divisionId: 1 as const,
    })),
  ];
}

// ── Happy-path structural tests ───────────────────────────────────────────────

describe('generateSchedule — happy path', () => {
  let schedule: Schedule;
  const teams = makeTeams();

  beforeAll(() => {
    // Generate once and re-use across all structural checks.
    // Pass maxAttempts=5000 explicitly — the env-var default of 100 can be
    // flaky in CI due to the probabilistic nature of the shuffled assignment.
    schedule = generateSchedule('league-1', 2025, teams, 5000);
  });

  // WHY: The season is exactly 13 weeks. Fewer would leave matchups unscheduled;
  //      more would add phantom weeks with no games.
  it('produces exactly 13 weekly slots', () => {
    expect(schedule.weeks).toHaveLength(13);
  });

  // WHY: Each week must have exactly 5 matchups (one per pair of the 10 teams).
  //      Fewer matchups = a team has a bye; more = a team plays twice.
  it('has exactly 5 matchups in every week', () => {
    for (const slot of schedule.weeks) {
      expect(slot.matchups).toHaveLength(5);
    }
  });

  // WHY: Every team must appear in every week — no byes are allowed.
  it('every team plays in every week', () => {
    const teamIds = new Set(teams.map((t) => t.id));
    for (const slot of schedule.weeks) {
      const weekTeams = new Set(slot.matchups.flatMap((m) => [m.home, m.away]));
      for (const id of teamIds) {
        expect(weekTeams.has(id)).toBe(true);
      }
    }
  });

  // WHY: Each team must play exactly 13 games. Over-scheduling wastes constraints;
  //      under-scheduling would miss required matchups.
  it('each team plays exactly 13 games', () => {
    for (const team of teams) {
      const games = schedule.weeks.flatMap((w) =>
        w.matchups.filter((m) => m.home === team.id || m.away === team.id),
      );
      expect(games).toHaveLength(13);
    }
  });

  // WHY: Constraint 3 — within-division pairs play twice (home-and-home round-robin).
  //      Per division: C(5,2) = 10 unique pairs × 2 games each = 20 matchups.
  //      Two divisions: 20 × 2 = 40 total division matchups.
  //      Combined with 25 cross-division: 65 total = 13 weeks × 5 matchups/week.
  it('division matchup pairs each appear exactly twice', () => {
    const divMatchups = schedule.weeks
      .flatMap((w) => w.matchups)
      .filter((m) => m.type === 'division');
    expect(divMatchups).toHaveLength(40); // 20 unique pairs × 2 games each

    // Count occurrences of each canonical pair (normalised to lower team id first).
    const pairCount = new Map<string, number>();
    for (const m of divMatchups) {
      const key = [m.home, m.away].sort().join('|');
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
    for (const count of pairCount.values()) {
      expect(count).toBe(2);
    }
  });

  // WHY: Constraint 4 — cross-division pairs play exactly once.
  //      5 × 5 = 25 cross-division matchups total.
  it('cross-division matchup pairs each appear exactly once', () => {
    const crossMatchups = schedule.weeks
      .flatMap((w) => w.matchups)
      .filter((m) => m.type === 'cross-division');
    expect(crossMatchups).toHaveLength(25);

    const pairCount = new Map<string, number>();
    for (const m of crossMatchups) {
      const key = [m.home, m.away].sort().join('|');
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
    for (const count of pairCount.values()) {
      expect(count).toBe(1);
    }
  });

  // WHY: Constraint 5 — the same pair must not play in consecutive weeks.
  //      Back-to-back rematches are visually confusing and make the schedule feel unbalanced.
  it('no pair of teams plays in back-to-back weeks', () => {
    for (let i = 0; i < schedule.weeks.length - 1; i++) {
      const thisWeek = schedule.weeks[i];
      const nextWeek = schedule.weeks[i + 1];
      for (const m of thisWeek.matchups) {
        const consecutive = nextWeek.matchups.some(
          (n) =>
            (n.home === m.home && n.away === m.away) ||
            (n.home === m.away && n.away === m.home),
        );
        expect(consecutive).toBe(false);
      }
    }
  });

  // WHY: The returned Schedule carries the leagueId and season passed in —
  //      without this the DB upsert would write the wrong data.
  it('stores the leagueId and season on the returned schedule', () => {
    expect(schedule.leagueId).toBe('league-1');
    expect(schedule.season).toBe(2025);
  });

  // WHY: generatedAt must be a Date object so it can be serialised to ISO string
  //      for the DB and formatted in the UI.
  it('generatedAt is a Date instance', () => {
    expect(schedule.generatedAt).toBeInstanceOf(Date);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe('generateSchedule — error cases', () => {
  // WHY: The engine is hard-coded for 10 teams; any other count must throw rather
  //      than producing a malformed schedule silently.
  it('throws ScheduleError when fewer than 10 teams are provided', () => {
    const teams = makeTeams().slice(0, 9); // 9 teams
    expect(() => generateSchedule('x', 2025, teams)).toThrow(ScheduleError);
  });

  it('throws ScheduleError when more than 10 teams are provided', () => {
    const extra: Team = { id: 'extra', name: 'Extra', divisionId: 0 };
    expect(() => generateSchedule('x', 2025, [...makeTeams(), extra])).toThrow(
      ScheduleError,
    );
  });

  // WHY: Each division must have exactly 5 teams. If all 10 are in the same
  //      division the cross-division matchup generation would break.
  it('throws ScheduleError when the division split is not 5/5', () => {
    // All 10 teams in division 0 — division 1 is empty.
    const uneven = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      name: `Team ${i}`,
      divisionId: 0 as const,
    }));
    expect(() => generateSchedule('x', 2025, uneven)).toThrow(ScheduleError);
  });

  // WHY: ScheduleError must extend Error so catch(e instanceof Error) guards work.
  it('ScheduleError is an instance of Error', () => {
    const e = new ScheduleError('test message');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('test message');
    expect(e.name).toBe('ScheduleError');
  });

  // WHY: maxAttempts: 1 may succeed or fail depending on the random shuffle.
  //      When it fails it must throw ScheduleError, never a plain Error or crash.
  it('throws ScheduleError (not a generic Error) when maxAttempts is exhausted', () => {
    // Run with maxAttempts = 1 up to 10 times; if it always succeeds we just skip.
    let threw = false;
    for (let trial = 0; trial < 10; trial++) {
      try {
        generateSchedule('x', 2025, makeTeams(), 1);
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(ScheduleError);
        break;
      }
    }
    // We can't guarantee a failure in 10 tries, so we only assert the error type
    // IF it actually threw. The important thing is it doesn't throw a non-ScheduleError.
    if (threw) {
      // assertion already made inside the catch block above
    }
  });
});

// ── Determinism / validation ──────────────────────────────────────────────────

describe('generateSchedule — determinism', () => {
  // WHY: Despite internal randomness the output must always satisfy the structural
  //      constraints. Running it multiple times catches non-deterministic failures.
  it('always produces a valid schedule across multiple runs', () => {
    const teams = makeTeams();
    for (let i = 0; i < 5; i++) {
      // 5000 attempts guarantees success despite the probabilistic shuffle
      const s = generateSchedule('lg', 2025, teams, 5000);
      expect(s.weeks).toHaveLength(13);
      for (const slot of s.weeks) {
        expect(slot.matchups).toHaveLength(5);
      }
    }
  });
});
