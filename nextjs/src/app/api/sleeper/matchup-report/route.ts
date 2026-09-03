// src/app/api/sleeper/matchup-report/route.ts
//
// Projects floor/ceiling for both sides of the user's current-week matchup.
//
// The projection is player form and nothing else. Defensive strength, weather
// and the betting line ride alongside it as context — read from the fixture the
// player is actually in, and reported rather than folded into the number. See
// src/lib/matchupContext.ts.
//
// Sources:
//   • Defensive strength  (from local NflWeeklyStat DB)
//   • Weather forecasts   (Open-Meteo — free, no key)
//   • Vegas/live odds     (The Odds API — needs ODDS_API_KEY env var)
//   • Fixtures            (local NflGame, synced from nflverse)
//
// GET /api/sleeper/matchup-report?leagueId=&userId=&season=&week=

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPlayerMapSafe, type SleeperPlayerInfo } from '@/lib/sleeper/playerCache';
import { buildUserMap, resolveTeamName } from '@/lib/sleeper/teams';
import { resolveSeason, resolveWeek } from '@/lib/sleeper/week';
import { resolveStatsSeason } from '@/lib/statsSeason';
import { buildGsisXref } from '@/lib/sleeper/gsisXref';
import { getScoringSettings } from '@/lib/sleeper/scoringSettings';
import { scoreRow, STAT_LINE_SELECT } from '@/lib/scoring';
import { buildBaselines, project } from '@/lib/projection';
import {
  fixturesByTeam, unitStrengths, venueForecasts, buildPlayerContext,
} from '@/lib/matchupContext';
import { abbrOf } from '@/lib/nflTeams';
import { sleeperGet } from '@/lib/sleeper/client';
import type { SleeperRoster, SleeperUser, SleeperMatchupRaw } from '@/lib/sleeper/types';
import { RouteCache, ROUTE_CACHE_TTL } from '@/lib/cache';
import type { PlayerProjection, TeamProjection, WeatherInfo, VegasLine, MatchupReportResponse } from '@/types/projections';
import type { StatLine } from '@/types/scoring';
import { getNflOdds } from '@/lib/odds';
import { ok, err } from '@/lib/api';

export type { PlayerProjection, TeamProjection, WeatherInfo, VegasLine, MatchupReportResponse };

// ─── Caches ───────────────────────────────────────────────────────────────────

const matchupCache = new RouteCache<MatchupReportResponse>();

const MATCHUP_TTL = ROUTE_CACHE_TTL.LIVE;

/**
 * The window's whole population, as both readings of it need it.
 *
 * `StatLine` is what scoring needs; the three join columns are what the
 * defense-strength reading needs.
 */
type WindowRow = StatLine & {
  playerId:     string;
  team:         string | null;
  opponentTeam: string | null;
  week:         number;
};

/** Positional baselines are the same rows for every request in a window. */
const baselineCache = new RouteCache<WindowRow[]>();
const BASELINE_TTL = 5 * 60_000;

/** Test seam — the baseline outlives a single request by design. */
export function clearBaselineCache(): void {
  baselineCache.clearAll();
}

/**
 * Every scored-position row in the form window, for the positional baselines.
 *
 * Deliberately not restricted to the two rosters in the matchup: thirty players
 * is too thin to say what a tight end typically scores, and the whole window is
 * only a couple of thousand rows.
 */
async function baselineRows(
  season: number,
  sinceWk: number,
  completedWk: number,
): Promise<WindowRow[]> {
  const key = `${season}-${sinceWk}-${completedWk}`;
  const hit = baselineCache.get(key, BASELINE_TTL);
  if (hit) return hit;

  const rows = await prisma.nflWeeklyStat.findMany({
    where: {
      season,
      seasonType: 'REG',
      week:       { gte: sinceWk, lte: completedWk },
      position:   { in: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] },
    },
    // team, opponentTeam and week are for the defense-strength reading; the
    // rest is what scoring a row needs.
    select: {
      playerId: true, team: true, opponentTeam: true, week: true,
      ...STAT_LINE_SELECT,
    },
  });
  baselineCache.set(key, rows);
  return rows;
}

/**
 * Extracts real player IDs from a Sleeper `starters` array.
 *
 * Sleeper fills unused lineup slots with the string "0" rather than omitting
 * them, so the raw array is not a usable ID list.
 */
function starterIdsOf(starters: string[] | undefined): string[] {
  return (starters ?? []).filter((id) => id && id !== '0');
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId')?.trim();
  const userId   = searchParams.get('userId')?.trim();

  if (!leagueId) return err('leagueId is required', 400);
  if (!userId)   return err('userId is required',   400);

  // ── Check response cache ───────────────────────────────────────────────────
  const cacheKey = `${leagueId}-${userId}-${searchParams.get('week') ?? 'cur'}`;
  const cached = matchupCache.get(cacheKey, MATCHUP_TTL);
  if (cached) return ok(cached);

  try {
    // ── Resolve the matchup from Sleeper ─────────────────────────────────────
    const effectiveSeason = await resolveSeason(searchParams.get('season'));
    const effectiveWeek   = await resolveWeek(searchParams.get('week'), 'current');

    const [rosters, users, matchupsRaw, playerMapFull] = await Promise.all([
      sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
      sleeperGet<SleeperUser[]>(`/league/${leagueId}/users`),
      sleeperGet<SleeperMatchupRaw[]>(`/league/${leagueId}/matchups/${effectiveWeek}`),
      getPlayerMapSafe(),
    ]);
    const localPlayerMap: Map<string, SleeperPlayerInfo> = playerMapFull;

    // "Unknown" rather than the shared "Team N" default: an empty opponent
    // slot in a report reads better unnamed than numbered.
    const usersById = buildUserMap(users);
    const teamNameOf = (ownerId: string | null) =>
      ownerId ? resolveTeamName(usersById.get(ownerId), ownerId, 'Unknown') : 'Unknown';

    const myRoster = rosters.find((r) => r.owner_id === userId);
    if (!myRoster) return err('Roster not found for this user', 404);

    const myMatchup = matchupsRaw.find((m) => m.roster_id === myRoster.roster_id);
    if (!myMatchup?.matchup_id) {
      return err('No matchup found for this week', 404);
    }

    const oppMatchup = matchupsRaw.find(
      (m) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster.roster_id,
    );
    if (!oppMatchup) return err('Opponent not found', 404);

    const oppRoster = rosters.find((r) => r.roster_id === oppMatchup.roster_id);

    const myPlayerIds  = myRoster.players ?? [];
    const oppPlayerIds = oppRoster?.players ?? [];

    // Sleeper pads unfilled lineup slots with "0", which is not a player ID.
    // An empty result is a real state — a league that has not set a lineup
    // yet, which before kickoff is most of them — and `starterIdsOf` leaves it
    // empty so the caller can decide what to do about it.
    const myStarterIds  = starterIdsOf(myMatchup.starters);
    const oppStarterIds = starterIdsOf(oppMatchup.starters);
    const myName        = teamNameOf(myRoster.owner_id);
    const oppName       = teamNameOf(oppRoster?.owner_id ?? null);
    const myRosterId    = myRoster.roster_id;
    const oppRosterId   = oppRoster?.roster_id ?? 0;

    // ── Build player stats (shared) ──────────────────────────────────────────
    const allIds = [...new Set([...myPlayerIds, ...oppPlayerIds])];

    // Which season the form window can actually be drawn from. In week 1 the
    // live season has no completed weeks, so this falls back to the last season
    // with rows and the report is built on last year's form instead of nothing.
    const stats = await resolveStatsSeason(effectiveSeason);

    // Anchor the window on the last week that has data, not the last week that
    // has been played: those differ before kickoff and whenever the nflverse
    // sync trails live play.
    const lastWk      = stats.maxWeek > 0 ? stats.maxWeek : Math.max(1, effectiveWeek - 1);
    const completedWk = stats.fallback ? lastWk : Math.min(lastWk, Math.max(1, effectiveWeek - 1));
    const sinceWk     = Math.max(1, completedWk - 5);

    // NflWeeklyStat is keyed on GSIS IDs; rosters are Sleeper IDs.
    const xref = await buildGsisXref(allIds, localPlayerMap, stats.season);

    // This league's rules, not nflverse's. The stored `fantasyPointsPpr` column
    // is full PPR, scores every kicker at zero and has no defense rows at all —
    // see src/lib/scoring.ts.
    const scoring = await getScoringSettings(leagueId);

    let statsRows: ({ playerId: string; week: number } & Parameters<typeof scoreRow>[0])[] = [];
    if (xref.gsisIds.length > 0) {
      statsRows = await prisma.nflWeeklyStat.findMany({
        where: {
          season:     stats.season,
          // Regular season only — see src/lib/statsSeason.ts on why postseason
          // weeks make a poor form window.
          seasonType: 'REG',
          playerId:   { in: xref.gsisIds },
          week:       { gte: sinceWk, lte: completedWk },
        },
        select: { playerId: true, week: true, ...STAT_LINE_SELECT },
      });
    }

    const playerWeeklyPts = new Map<string, number[]>();
    for (const row of statsRows) {
      const sleeperId = xref.toSleeper.get(row.playerId);
      if (!sleeperId) continue;
      const arr = playerWeeklyPts.get(sleeperId) ?? [];
      arr.push(scoreRow(row, scoring));
      playerWeeklyPts.set(sleeperId, arr);
    }

    // What each position typically does over the same weeks. A player with one
    // game or none is blended toward this rather than reported as a certainty —
    // see src/lib/projection.ts. Drawn from every player in the window, not just
    // the two rosters, which would be a sample of about thirty.
    // One population, two readings: what each position typically scores, and
    // what each defense concedes to it.
    const windowRows = await baselineRows(stats.season, sinceWk, completedWk);
    const baselines  = buildBaselines(windowRows, scoring);

    // ── Context for the reader, not for the arithmetic ───────────────────────
    // None of this changes a projection. It is the fixture each player is in,
    // the unit opposite them and the betting line — the things a manager needs
    // to judge a number, and the things the app could not look up at all until
    // NflGame existed. See src/lib/matchupContext.ts.
    const fixtures  = await fixturesByTeam(effectiveSeason, effectiveWeek);
    const strengths = unitStrengths(windowRows, (row) => scoreRow(row, scoring));
    const forecasts = await venueForecasts(fixtures, effectiveWeek);

    // ── Vegas / live odds ────────────────────────────────────────────────────
    const apiKey   = process.env.ODDS_API_KEY;
    let vegasLines: VegasLine[] | null = null;
    if (apiKey) {
      vegasLines = await getNflOdds(effectiveWeek).catch(() => null);
    }

    // Betting lines indexed by fixture, so a player's own game can be found.
    // They used to be rendered unfiltered — the first three on the slate,
    // whoever was playing.
    //
    // Keyed on both teams rather than one: the odds endpoint returns every
    // upcoming game in the season at once, so indexing by team would leave each
    // one holding whichever of its games came last in the response. Home and
    // away together are unique even for divisional rivals, who meet twice but
    // host once each.
    const linesByGame = new Map<string, VegasLine>();
    for (const line of vegasLines ?? []) {
      const home = abbrOf(line.homeTeam);
      const away = abbrOf(line.awayTeam);
      if (home && away) linesByGame.set(`${home}|${away}`, line);
    }

    // ── Project each player ──────────────────────────────────────────────────
    /**
     * Projects a player's fantasy floor, ceiling, and mean score for the
     * upcoming week based on their recent game history.
     *
     * Methodology:
     *   1. Compute mean and standard deviation of points from the last 6
     *      completed weeks (or fewer if the player has limited data).
     *   2. Floor = mean − 1.28σ  (≈10th percentile); clamped to 0.
     *   3. Ceiling = mean + 1.28σ (≈90th percentile).
     *
     * There are no adjustments. Two used to be applied here and both are gone:
     *
     *   - A defensive-strength multiplier, which never actually ran — the lookup
     *     needed each player's week-N opponent and nothing supplied one, so it
     *     returned 1 every time while its query still scanned the season.
     *   - A weather multiplier, which did run, on the wrong forecast: it was
     *     keyed on each player's own home stadium rather than the venue, so a
     *     player on the road was adjusted for a city he was not in.
     *
     * Both factors are now shown rather than applied. The context dialog reads
     * the real venue and the real opponent and says which way each pushes,
     * leaving the judgement to the reader — see src/lib/matchupContext.ts.
     *
     * Every rostered player is projected, starter or not. Only starters reach
     * the team totals — see sumTeam — but the bench is projected so the
     * breakdown is complete and its points can be reported alongside them.
     *
     * `sigma` is returned alongside the band because sumTeam needs it and it
     * cannot be read back off floor/ceiling: the floor is clamped at 0, so a
     * volatile low-scorer's visible band understates his real spread.
     */
    function projectPlayer(pid: string, isStarter: boolean): PlayerProjection {
      const info = localPlayerMap.get(pid);
      const name = info?.name      ?? `#${pid}`;
      const pos  = info?.position  ?? 'UNK';
      const team = info?.team      ?? null;
      const pts  = playerWeeklyPts.get(pid) ?? [];

      const { mean, sigma: sd, games } = project(pts, baselines.get(pos));
      const rawFloor   = Math.max(0, mean - 1.28 * sd);
      const rawCeiling = mean + 1.28 * sd;

      const floor     = parseFloat(rawFloor.toFixed(1));
      const ceiling   = parseFloat(rawCeiling.toFixed(1));
      const projected = parseFloat(mean.toFixed(1));
      const sigma     = parseFloat(sd.toFixed(2));

      return {
        // pid is already the Sleeper ID, which is what the CDN headshots key on.
        playerId: pid, sleeperPlayerId: pid, name, position: pos, team,
        floor, ceiling, projected, sigma, games,
        starter: isStarter,
        context: buildPlayerContext(team, pos, fixtures, strengths, forecasts, linesByGame),
      };
    }

    /**
     * Marks which players start, then projects the whole roster.
     *
     * A league that has not set its lineup yet reports no starters at all. The
     * roster is treated as all-starting in that case: showing a team total of
     * zero would read as a broken panel, where showing the full roster is at
     * least a truthful "here is everything you have".
     */
    function projectRoster(playerIds: string[], starterIds: string[]): PlayerProjection[] {
      // Sleeper's `starters` array is in lineup-slot order (QB, RB, RB, WR …),
      // which the roster array is not. Ordering by slot is what makes the
      // breakdown read as a lineup rather than an arbitrary list.
      const slotOf = new Map(starterIds.map((pid, i) => [pid, i]));
      const lineupSet = slotOf.size > 0;
      if (!lineupSet) return playerIds.map((pid) => projectPlayer(pid, true));

      const ordered = [...playerIds].sort((a, b) =>
        (slotOf.get(a) ?? Number.MAX_SAFE_INTEGER) - (slotOf.get(b) ?? Number.MAX_SAFE_INTEGER),
      );
      return ordered.map((pid) => projectPlayer(pid, slotOf.has(pid)));
    }

    const myProjections  = projectRoster(myPlayerIds,  myStarterIds);
    const oppProjections = projectRoster(oppPlayerIds, oppStarterIds);

    /**
     * Aggregates individual player projections into a team-level projection.
     *
     * Only starters are counted: a bench player cannot score for you, so
     * including one inflates a deep roster against an opponent who simply
     * carries fewer players. The bench is reported separately rather than
     * dropped.
     *
     * The band is rebuilt from the combined spread, not by adding the players'
     * own floors and ceilings. Summing nine 10th-percentiles does not give the
     * team's 10th percentile — it gives the case where every starter has a bad
     * week at once, which is far less likely than any one of them doing so, and
     * produced a band more than twice as wide as it should be. Standard
     * deviations do not add; variances do:
     *
     *     team sigma = sqrt( sum of each starter's sigma squared )
     *     band       = team projection +/- 1.28 * team sigma
     *
     * This treats the starters as independent. They are not quite — a QB and
     * his own receiver rise and fall together — so the real spread is a little
     * wider than this. Correlated variance needs each player's game, which is
     * the same NFL fixture source the weather and defensive adjustments want.
     */
    function sumTeam(projs: PlayerProjection[], name: string, rosterId: number): TeamProjection {
      const starters = projs.filter((p) => p.starter);
      const bench    = projs.filter((p) => !p.starter);

      const projected = starters.reduce((s, p) => s + p.projected, 0);
      const teamSigma = Math.sqrt(starters.reduce((s, p) => s + p.sigma ** 2, 0));
      const spread    = 1.28 * teamSigma;

      return {
        name,
        rosterId,
        floor:     parseFloat(Math.max(0, projected - spread).toFixed(1)),
        ceiling:   parseFloat((projected + spread).toFixed(1)),
        projected: parseFloat(projected.toFixed(1)),
        sigma:     parseFloat(teamSigma.toFixed(2)),
        starterCount:   starters.length,
        benchProjected: parseFloat(bench.reduce((s, p) => s + p.projected, 0).toFixed(1)),
        benchCount:     bench.length,
      };
    }

    const myTeam   = sumTeam(myProjections,  myName,  myRosterId);
    const opponent = sumTeam(oppProjections, oppName, oppRosterId);

    // ── Narrative ────────────────────────────────────────────────────────────
    const myWins   = myTeam.floor > opponent.ceiling;
    const myLikely = myTeam.projected > opponent.projected;
    const close    = Math.abs(myTeam.projected - opponent.projected) < 10;
    // Weather worth mentioning, taken from the venues these players are actually
    // at rather than from their home grounds. Deduped by team: a whole roster in
    // one bad game should read as one warning, not nine.
    const roughWeather = new Map<string, WeatherInfo>();
    for (const p of [...myProjections, ...oppProjections]) {
      const wx = p.context.weather;
      if (wx && (wx.windMph > 20 || wx.precipPct > 60 || wx.tempF < 20)) {
        roughWeather.set(wx.team, wx);
      }
    }
    const wxImpact = roughWeather.size > 0;

    let narrative = '';
    if (myWins) {
      narrative = `Your floor (${myTeam.floor}) exceeds their ceiling (${opponent.ceiling}) — you're a strong favourite this week. `;
    } else if (myLikely && !close) {
      narrative = `You project ahead ${myTeam.projected.toFixed(1)}–${opponent.projected.toFixed(1)}, though the ranges overlap. `;
    } else if (close) {
      narrative = `Tight matchup — projected scores are within 10 points of each other. `;
    } else {
      narrative = `You're the underdog (${myTeam.projected.toFixed(1)} vs ${opponent.projected.toFixed(1)}), but your ceiling (${myTeam.ceiling}) still gives you a path. `;
    }
    if (wxImpact) {
      narrative += `Weather may be a factor: ${[...roughWeather.values()].map((w) => w.note).join('; ')}.`;
    }

    const result: MatchupReportResponse = {
      week:    effectiveWeek,
      season:  effectiveSeason,
      statsSeason:   stats.season,
      statsFallback: stats.fallback,
      myTeam,
      opponent,
      myPlayers:       myProjections,
      opponentPlayers: oppProjections,
      narrative: narrative.trim(),
    };

    matchupCache.set(cacheKey, result);
    return ok(result);

  } catch (error) {
    const msg    = error instanceof Error ? error.message : 'Upstream error';
    const status = msg.includes('404') ? 404 : 502;
    return err(msg, status);
  }
}
