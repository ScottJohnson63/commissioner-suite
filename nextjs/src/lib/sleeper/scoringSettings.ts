// src/lib/sleeper/scoringSettings.ts
//
// One league's scoring rules, fetched from Sleeper and cached.
//
// Every league object Sleeper serves carries a full `scoring_settings` map. The
// app needs it because the three leagues in this deployment do not agree — one
// splits field goals at 50-59 and 60+ where another stops at 50+ — so points
// cannot be computed once and shared. See src/lib/scoring.ts for what is done
// with them.

import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import { RouteCache } from '@/lib/cache';
import type { ScoringSettings } from '@/lib/scoring';

/**
 * Scoring rules change at most once a season, and only by a commissioner
 * deliberately editing them, so this is cached far longer than league state.
 */
const SETTINGS_TTL = 60 * 60 * 1000; // 1 hour

const cache = new RouteCache<ScoringSettings>();

/**
 * Sleeper's league payload, narrowed to the part this module reads.
 * `scoring_settings` is a flat map of category → points.
 */
interface LeagueWithScoring {
  scoring_settings?: Record<string, number> | null;
}

/**
 * Returns the league's scoring settings, or an empty object when Sleeper cannot
 * be reached.
 *
 * An empty object is a deliberate choice rather than a throw: every read in
 * `scoring.ts` defaults to 0, so a failed fetch degrades to standard scoring
 * with no receptions and no kicking — visibly low numbers on one panel, rather
 * than a failed request. Callers that need to distinguish the two should check
 * for an empty object.
 */
export async function getScoringSettings(leagueId: string): Promise<ScoringSettings> {
  const hit = cache.get(leagueId, SETTINGS_TTL);
  if (hit) return hit;

  try {
    const league = await sleeperGet<LeagueWithScoring>(
      `/league/${leagueId}`,
      SLEEPER_TTL.LEAGUE,
    );
    const settings = (league.scoring_settings ?? {}) as ScoringSettings;
    cache.set(leagueId, settings);
    return settings;
  } catch {
    return {};
  }
}

/** Test seam — drops every cached league's settings. */
export function clearScoringSettingsCache(): void {
  cache.clearAll();
}
