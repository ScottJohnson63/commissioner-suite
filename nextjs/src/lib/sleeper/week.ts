// src/lib/sleeper/week.ts
//
// "Which NFL season and week are we talking about?" — one implementation.
//
// Both answers come from the same `/state/nfl` call, so they live together.
//
// Routes accept an explicit ?week=, and fall back to asking Sleeper when it is
// absent. Two different answers are wanted depending on the route:
//
//   'current'   — the week now in progress. What a live matchup report is about.
//   'completed' — the week that just finished. What waiver and scoring views
//                 want, since the current week has no meaningful results yet.
//
// Both fall back to week 1 if Sleeper is unreachable, so a failed state call
// degrades to a readable page rather than a 500.

import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import type { SleeperNflState } from '@/lib/sleeper/types';

export type WeekMode = 'current' | 'completed';

/**
 * Resolves the NFL season a request is about.
 *
 * Order: an explicit `?season=`, then NFL_SEASON, then whatever Sleeper says is
 * current, then the calendar year. NFL_SEASON outranks Sleeper because it is
 * also what the stat sync writes rows under — reading a season the sync is not
 * writing is the failure this ordering exists to prevent.
 *
 * @param requested  Raw `?season=` value from the query string, or null.
 * @returns          A four-digit season year.
 */
export async function resolveSeason(
  requested?: string | number | null,
): Promise<number> {
  const explicit = requested == null || requested === '' ? null : Number(requested);
  if (explicit !== null && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const configured = Number(process.env.NFL_SEASON);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  try {
    const state = await sleeperGet<SleeperNflState>('/state/nfl', SLEEPER_TTL.NFL_STATE);
    const season = Number(state.season);
    if (Number.isFinite(season) && season > 0) return season;
  } catch {
    // Fall through to the calendar year.
  }

  return new Date().getFullYear();
}

/**
 * Resolves the week a request is about.
 *
 * @param requested  Raw `?week=` value from the query string, or null.
 * @param mode       Whether the caller wants the in-progress week or the last
 *                   completed one. Ignored when `requested` is supplied — an
 *                   explicit week is always taken at face value.
 * @returns          A week number, never less than 1.
 */
export async function resolveWeek(
  requested: string | number | null | undefined,
  mode: WeekMode = 'current',
): Promise<number> {
  const explicit = requested == null || requested === '' ? null : Number(requested);
  if (explicit !== null && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  try {
    const state = await sleeperGet<SleeperNflState>('/state/nfl', SLEEPER_TTL.NFL_STATE);
    return weekOf(state, mode);
  } catch {
    // Sleeper down or rate-limited. Week 1 keeps the page renderable.
    return 1;
  }
}

/**
 * Both readings of the week, from one look at the NFL state.
 *
 * For a route that needs the completed week *and* the current one — the waiver
 * panel draws form from the week that finished and describes the fixtures of the
 * week about to be played. Calling `resolveWeek` twice asks the same question
 * twice: the two answers always come from a single `/state/nfl` document, and
 * splitting them across two calls only creates two chances to read it.
 *
 * @param requested  Raw `?week=` value. When supplied it is taken at face value
 *                   for both, which is what an explicit week means.
 */
export async function resolveWeeks(
  requested: string | number | null | undefined,
): Promise<{ completed: number; current: number }> {
  const explicit = requested == null || requested === '' ? null : Number(requested);
  if (explicit !== null && Number.isFinite(explicit) && explicit > 0) {
    return { completed: explicit, current: explicit };
  }

  try {
    const state = await sleeperGet<SleeperNflState>('/state/nfl', SLEEPER_TTL.NFL_STATE);
    return { completed: weekOf(state, 'completed'), current: weekOf(state, 'current') };
  } catch {
    return { completed: 1, current: 1 };
  }
}

/** One reading of a fetched state. Shared so the two entry points cannot drift. */
function weekOf(state: SleeperNflState, mode: WeekMode): number {
  return mode === 'completed' ? Math.max(1, state.week - 1) : Math.max(1, state.week);
}
