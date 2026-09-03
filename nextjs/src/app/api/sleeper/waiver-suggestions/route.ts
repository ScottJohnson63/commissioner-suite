// src/app/api/sleeper/waiver-suggestions/route.ts
//
// Scans the user's roster for positional weaknesses, then surfaces the best
// available (un-rostered) players to address those gaps.
//
// Every number on the panel describes one window — three weeks of one season,
// named on the response so the UI can say so rather than implying "recently".
// Alongside the average, each player carries the same projection band and the
// same fixture/defense/weather/line context the matchup report shows, built by
// the same modules so the two panels cannot drift apart.
//
// GET /api/sleeper/waiver-suggestions?leagueId=&userId=&season=&week=

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPlayerMapSafe } from '@/lib/sleeper/playerCache';
import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import { resolveSeason, resolveWeek } from '@/lib/sleeper/week';
import { resolveStatsSeason } from '@/lib/statsSeason';
import { buildGsisXref } from '@/lib/sleeper/gsisXref';
import { getScoringSettings } from '@/lib/sleeper/scoringSettings';
import { getStarterSlots } from '@/lib/sleeper/lineup';
import { scoreRow, STAT_LINE_SELECT } from '@/lib/scoring';
import { buildBaselines, project } from '@/lib/projection';
import { loadWindowRows } from '@/lib/formWindow';
import {
  fixturesByTeam, unitStrengths, venueForecasts, buildPlayerContext,
} from '@/lib/matchupContext';
import { abbrOf } from '@/lib/nflTeams';
import { getNflOdds } from '@/lib/odds';
import type { SleeperRoster, SleeperTrendingRaw } from '@/lib/sleeper/types';
import type { VegasLine } from '@/types/projections';
import { RouteCache, ROUTE_CACHE_TTL } from '@/lib/cache';
import type { WaiverSuggestion, WaiverSuggestionsResponse, StatWindow } from '@/types/suggestions';
import { ok, err } from '@/lib/api';

export type { WaiverSuggestion, WaiverSuggestionsResponse };

const LIVE_TTL = ROUTE_CACHE_TTL.LIVE;

// ─── In-process cache ─────────────────────────────────────────────────────────

const cache = new RouteCache<WaiverSuggestionsResponse>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'] as const;
type SkillPos = (typeof SKILL_POSITIONS)[number];

function isSkillPos(p: string): p is SkillPos {
  return (SKILL_POSITIONS as readonly string[]).includes(p);
}

/**
 * Weeks the average covers.
 *
 * Three, because that is what the panel says. It is stated here rather than
 * spelled into the query so the label and the window cannot disagree — the two
 * used to, and the average silently covered whatever weeks happened to have
 * rows.
 */
const WINDOW_WEEKS = 3;

/** How far below the league median a position has to sit to count as weak. */
const WEAK_THRESHOLD = 0.85; // >15% below

/** Percentile the floor/ceiling band is read at — 1.28σ ≈ 10th/90th. */
const BAND_Z = 1.28;

/** How many suggestions the panel shows. */
const TOP_N = 8;

/** Mean of a list, or 0 when it is empty. */
function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * True median, not the upper-middle value.
 *
 * An even-sized league — which is every league — has no single middle roster,
 * and taking `sorted[len / 2]` compared each manager against the sixth-best of
 * ten rather than the midpoint. That reads a shade high for everyone, so
 * marginal positions were flagged weak slightly too often.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId')?.trim();
  const userId   = searchParams.get('userId')?.trim();

  if (!leagueId) return err('leagueId is required', 400);
  if (!userId)   return err('userId is required',   400);

  // The week is part of the key: it now picks the fixtures the context cards
  // describe, not just the stat window, so two weeks are two different answers.
  const cacheKey = `${leagueId}-${userId}-${searchParams.get('week') ?? 'cur'}`;
  const hit = cache.get(cacheKey, LIVE_TTL);
  if (hit) return ok(hit);

  try {
    // ── Data-gathering phase ───────────────────────────────────────────────────

    type PlayerInfo  = { name: string; position: string; team: string | null; gsisId: string | null };
    type RosterEntry = { roster_id: number; owner_id: string | null; players: string[] | null };

    const season = await resolveSeason(searchParams.get('season'));
    // Two readings of the same NFL state, from one cached call. Form is drawn
    // from the week that has finished; the context cards describe the week about
    // to be played, which is the one a waiver claim is actually for.
    const completedWeek = await resolveWeek(searchParams.get('week'), 'completed');
    const upcomingWeek  = await resolveWeek(searchParams.get('week'), 'current');

    const [rosters, trendingRaw, livePlayerMap] = await Promise.all([
      sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
      sleeperGet<SleeperTrendingRaw[]>('/players/nfl/trending/add?lookback_hours=168&limit=50', SLEEPER_TTL.TRENDING),
      getPlayerMapSafe(),
    ]);

    const rosterList: RosterEntry[]      = rosters;
    const playerMap: Map<string, PlayerInfo> = livePlayerMap;
    const trendingCount = new Map(trendingRaw.map((t) => [t.player_id, t.count]));

    const myRoster = rosters.find((r) => r.owner_id === userId);
    if (!myRoster) {
      return err('Roster not found for this user', 404);
    }

    const rosteredSet = new Set<string>();
    for (const r of rosters) {
      for (const pid of r.players ?? []) rosteredSet.add(pid);
    }

    const myPlayerIds  = myRoster.players ?? [];
    const availableIds = trendingRaw
      .filter((t) => !rosteredSet.has(t.player_id))
      .map((t) => t.player_id);

    // ── Fetch stats from DB (the three-week window) ────────────────────────────
    //
    // Every rostered player counts, not just mine: the positional-weakness test
    // below compares my starters against the league median, which is zero for
    // everyone if the other nine rosters are never looked up.
    const allRelevantIds = [...new Set([
      ...rosterList.flatMap((r) => r.players ?? []),
      ...myPlayerIds,
      ...availableIds,
    ])];

    // ── Which season, and which three weeks of it, the table can answer for ──
    // Before kickoff the live season has no rows at all, so this falls back to
    // the last season that does and the panel reads last year's form rather than
    // a column of zeros.
    const stats   = await resolveStatsSeason(season);
    // This league's rules — the stored PPR column is full PPR and scores kickers
    // and defenses at zero. See src/lib/scoring.ts.
    const scoring = await getScoringSettings(leagueId);

    // Where the window ends.
    //
    // This is the fix for a window that used to land on the wrong weeks
    // entirely. It was `min(completedWeek, stats.maxWeek)`, which is right only
    // while the stat season and the live season are the same one. On a
    // fallback — every week before the new season has four of its own, and any
    // stretch where the nflverse sync has not caught up — `completedWeek` is a
    // week number in *this* season being used to index *last* season, so in
    // week 3 of 2025 the "last three weeks" were weeks 1-2 of 2024: the opening
    // of the wrong year rather than the close of it.
    //
    // A completed season's last three weeks are its most recent form, so a
    // fallback anchors on its final week. A live season anchors on the last
    // week that actually has rows, which trails the last week played whenever
    // the sync does.
    const lastSyncedWeek = stats.maxWeek > 0 ? stats.maxWeek : completedWeek;
    const endWeek   = stats.fallback ? lastSyncedWeek : Math.min(lastSyncedWeek, completedWeek);
    const startWeek = Math.max(1, endWeek - (WINDOW_WEEKS - 1));

    // Deliberately not named `window`: this runs in Node, but shadowing the
    // browser global in a file this long invites a confusing read.
    const statWindow: StatWindow = {
      season:    stats.season,
      startWeek,
      endWeek,
      fallback:  stats.fallback,
    };

    // ── Build the Sleeper → GSIS cross-reference ──────────────────────────────
    // NflWeeklyStat is keyed on GSIS IDs; everything above is keyed on Sleeper
    // IDs. Querying with the wrong ones returns no rows and reads as "nobody
    // scored", so the translation has to happen before either query. See
    // src/lib/sleeper/gsisXref.ts for why the Sleeper gsis_id field alone is not
    // enough.
    const xref = await buildGsisXref(allRelevantIds, playerMap, stats.season);

    const availableGsisIds = availableIds
      .map((pid) => xref.toGsis.get(pid))
      .filter((g): g is string => g != null);

    // ── Three parallel reads ──────────────────────────────────────────────────
    // 1. The window's rows for the players on this page — the average.
    // 2. Season-wide headshot lookup for the waiver pool — the nflverse-sourced
    //    headshot URLs the component prefers over Sleeper's CDN.
    // 3. The window's whole population — positional baselines for the projection
    //    band, and what each defense concedes for the context card. Shared with
    //    the matchup report, which reads the same rows. See src/lib/formWindow.ts.
    const [statsRows, headshotRows, windowRows] = await Promise.all([
      xref.gsisIds.length > 0
        ? prisma.nflWeeklyStat.findMany({
            where: {
              season:     stats.season,
              // Regular season only: postseason weeks cover a shrinking subset
              // of players, so including them scores a non-playoff player's
              // absence as a zero game.
              seasonType: 'REG',
              week:       { gte: startWeek, lte: endWeek },
              playerId:   { in: xref.gsisIds },
            },
            select: { playerId: true, ...STAT_LINE_SELECT },
          })
        : Promise.resolve([]),
      availableGsisIds.length > 0
        ? prisma.nflWeeklyStat.findMany({
            where: {
              season:   stats.season,
              playerId: { in: availableGsisIds },
              headshot:  { not: null },
            },
            select:   { playerId: true, headshot: true },
            distinct: ['playerId'],
          })
        : Promise.resolve([]),
      loadWindowRows(stats.season, startWeek, endWeek),
    ]);

    // Map headshots back from GSIS IDs → Sleeper IDs so the component can use them.
    const playerPoints   = new Map<string, number[]>();
    const playerHeadshot = new Map<string, string>(); // sleeperPlayerId → NFL CDN URL

    // Both queries came back keyed on GSIS IDs; everything downstream — rosters,
    // the waiver pool, the rendered rows — speaks Sleeper IDs, so map back here.
    for (const row of headshotRows) {
      const sleeperId = xref.toSleeper.get(row.playerId);
      if (sleeperId && row.headshot) playerHeadshot.set(sleeperId, row.headshot);
    }
    // One row per player per week: NflWeeklyStat is unique on
    // (season, week, playerId), so a player contributes each week at most once
    // and the count below is a game count.
    for (const row of statsRows) {
      const sleeperId = xref.toSleeper.get(row.playerId);
      if (!sleeperId) continue;
      const arr = playerPoints.get(sleeperId) ?? [];
      arr.push(scoreRow(row, scoring));
      playerPoints.set(sleeperId, arr);
    }

    // What each position typically scores over the same weeks. A player with one
    // game or none is blended toward this rather than reported as a certainty —
    // see src/lib/projection.ts. Drawn from every player in the window, which is
    // what makes a band around a thin sample mean anything.
    const baselines = buildBaselines(windowRows, scoring);

    /** Points per game actually played in the window. 0 when the player played none. */
    function avg(pid: string): number {
      return mean(playerPoints.get(pid) ?? []);
    }

    /** Games behind that average — the difference between "12.0" and "12.0 once". */
    function gamesPlayed(pid: string): number {
      return playerPoints.get(pid)?.length ?? 0;
    }

    /**
     * The projection band, by the same method the matchup report uses.
     *
     * Centred on the blended mean rather than the raw average, so a player with
     * one game gets a band wide enough to say the average behind it is one
     * number. The two can therefore disagree, and are labelled separately.
     */
    function bandOf(pid: string, pos: string): { floor: number; ceiling: number; projected: number } {
      const { mean: m, sigma } = project(playerPoints.get(pid) ?? [], baselines.get(pos));
      return {
        floor:     parseFloat(Math.max(0, m - BAND_Z * sigma).toFixed(1)),
        ceiling:   parseFloat((m + BAND_Z * sigma).toFixed(1)),
        projected: parseFloat(m.toFixed(1)),
      };
    }

    // ── Positional weakness (league-median comparison) ─────────────────────────
    //
    // Rebuilt around two things the old test got wrong.
    //
    // It compared each roster's single best player at a position. That is the
    // right question for QB and TE and the wrong one for RB and WR: a league
    // starting two of each is not described by its best one, so a team with an
    // elite RB1 and nothing behind him read as strong at running back while
    // starting a replacement-level RB2 every week. The comparison now runs over
    // as many players as the league actually starts there.
    //
    // And it only counted a roster at a position it carried a player for, so a
    // league where three teams carry no kicker took the kicker median over the
    // seven that do — the teams with the hole, which is the thing being measured,
    // were the ones left out of it. Every roster is now counted at every
    // position, with an unfilled slot scoring zero, which is what an unfilled
    // slot is worth.
    const starterSlots = await getStarterSlots(leagueId);

    /**
     * A roster's production from the players it would start at `pos`.
     *
     * Built on the observed average rather than the projected mean above. The
     * projection deliberately pulls a thin sample toward what the position
     * typically does, which is right for "what will he score next week" and
     * wrong here: applied to every roster it drags them all toward the same
     * number and flattens the comparison the median depends on. A player with no
     * games therefore counts as the zero he produced, and only reaches the group
     * at all when the roster is short of bodies — which is the hole being looked
     * for.
     */
    function startingGroup(playerIds: string[], pos: SkillPos): number {
      const slots = starterSlots[pos] ?? 0;
      if (slots === 0) return 0;
      const values = playerIds
        .filter((pid) => playerMap.get(pid)?.position === pos)
        .map(avg)
        .sort((a, b) => b - a)
        .slice(0, slots);
      // Short of bodies is the weakness, so the empty slots count as zero rather
      // than being averaged away.
      while (values.length < slots) values.push(0);
      return mean(values);
    }

    const weakPositions: string[] = [];
    for (const pos of SKILL_POSITIONS) {
      if ((starterSlots[pos] ?? 0) === 0) continue; // the league does not start one
      const leagueValues = rosterList.map((r) => startingGroup(r.players ?? [], pos));
      const par = median(leagueValues);
      // A median of zero says the window has nothing to compare on — a position
      // nobody scored in, or a season with no rows. Everyone is equally short of
      // nothing, so nothing is weak.
      if (par <= 0) continue;
      if (startingGroup(myPlayerIds, pos) < par * WEAK_THRESHOLD) weakPositions.push(pos);
    }

    // ── Score & rank available players ────────────────────────────────────────

    type ScoredSuggestion = Omit<WaiverSuggestion, 'context'> & { _score: number };
    const suggestions: ScoredSuggestion[] = [];

    // Say which weeks the average covers.
    //
    // Counted from the window rather than written out, because the window is not
    // always three weeks wide: in week 2, or wherever the sync has only reached
    // week 1, there are fewer to average and "last 3 wks" would be a claim about
    // weeks that do not exist. Naming the season matters only when it is not the
    // one being played — "last 3 wks" would otherwise imply this year.
    const spanWeeks = endWeek - startWeek + 1;
    const windowLabel = stats.fallback
      ? `wks ${startWeek}-${endWeek} of ${stats.season}`
      : spanWeeks === 1 ? `wk ${endWeek}` : `last ${spanWeeks} wks`;

    for (const pid of availableIds) {
      const info = playerMap.get(pid);
      if (!info) continue;
      const pos  = info.position;
      if (!isSkillPos(pos)) continue;

      const recentAvg  = avg(pid);
      const games      = gamesPlayed(pid);
      const band       = bandOf(pid, pos);
      const isWeak     = weakPositions.includes(pos);
      const needBonus  = isWeak ? 15 : 0;
      const score      = recentAvg * 0.7 + needBonus * 0.3;
      const trendCount = trendingCount.get(pid) ?? null;

      const reason = isWeak
        ? `Addresses ${pos} weakness — ${recentAvg.toFixed(1)} pts avg ${windowLabel}`
        : `Strong recent form — ${recentAvg.toFixed(1)} pts avg ${windowLabel}${trendCount ? ` · ${trendCount.toLocaleString()} adds` : ''}`;

      suggestions.push({
        playerId: pid, name: info.name, position: pos, team: info.team,
        headshot: playerHeadshot.get(pid) ?? null,
        recentAvg, games, ...band,
        reason, trendingCount: trendCount, _score: score,
      });
    }

    suggestions.sort((a, b) => b._score - a._score);
    const shortlist = suggestions.slice(0, TOP_N);

    // Fallback when there's no DB data: sort by trending volume.
    if (shortlist.every((s) => s.recentAvg === 0)) {
      shortlist.sort((a, b) => (b.trendingCount ?? 0) - (a.trendingCount ?? 0));
    }

    // ── Context for the reader, not for the arithmetic ───────────────────────
    // The same fixture, opposing unit, forecast and betting line the matchup
    // report shows, from the same modules. None of it changes a number above it.
    // Built for the shortlist only: it is what the panel renders, and the
    // trending feed is fifty players deep.
    //
    // Fixtures come from the live season and the week about to be played — the
    // week a claim is for — even when the form window above reads an earlier
    // season. Defensive strength is read from that window, because it is the
    // stretch there is data for.
    const fixtures  = await fixturesByTeam(season, upcomingWeek);
    const strengths = unitStrengths(windowRows, (row) => scoreRow(row, scoring));
    const forecasts = await venueForecasts(fixtures, upcomingWeek);

    const vegasLines = process.env.ODDS_API_KEY
      ? await getNflOdds(upcomingWeek).catch(() => null)
      : null;

    // Keyed on both teams rather than one: the odds endpoint returns every
    // upcoming game in the season at once, so indexing by team would leave each
    // one holding whichever of its games came last in the response.
    const linesByGame = new Map<string, VegasLine>();
    for (const line of vegasLines ?? []) {
      const home = abbrOf(line.homeTeam);
      const away = abbrOf(line.awayTeam);
      if (home && away) linesByGame.set(`${home}|${away}`, line);
    }

    const top: WaiverSuggestion[] = shortlist.map((s) => {
      const { _score: _ignored, ...rest } = s;
      void _ignored;
      return {
        ...rest,
        context: buildPlayerContext(s.team, s.position, fixtures, strengths, forecasts, linesByGame),
      };
    });

    const result: WaiverSuggestionsResponse = {
      weakPositions,
      starterSlots,
      suggestions: top,
      window: statWindow,
      week: upcomingWeek,
      statsSeason:   stats.season,
      statsFallback: stats.fallback,
    };
    cache.set(cacheKey, result);
    return ok(result);

  } catch (error) {
    const msg    = error instanceof Error ? error.message : 'Upstream error';
    const status = msg.includes('404') ? 404 : 502;
    return err(msg, status);
  }
}
