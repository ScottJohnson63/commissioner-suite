// src/app/api/sleeper/waiver-suggestions/route.ts
//
// Scans the user's roster for positional weaknesses, then surfaces the best
// available (un-rostered) players to address those gaps.
//
// GET /api/sleeper/waiver-suggestions?leagueId=&userId=&season=&week=
//
// DEMO_MODE=true: bypasses Sleeper API, uses mock rosters from
//   src/mock_data/matchup.json  (team1 = "my roster", team2 = opponent)
//   src/mock_data/waiver.json   (availablePlayers = waiver pool)
// Stats are still queried from the DB using real GSIS IDs; mockAvgPts in
// waiver.json provides a fallback when the DB has no data for a player.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPlayerMapSafe } from '@/lib/sleeper/playerCache';
import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import { resolveSeason, resolveWeek } from '@/lib/sleeper/week';
import { resolveStatsSeason } from '@/lib/statsSeason';
import { buildGsisXref } from '@/lib/sleeper/gsisXref';
import { getScoringSettings } from '@/lib/sleeper/scoringSettings';
import { scoreRow, STAT_LINE_SELECT } from '@/lib/scoring';
import type { SleeperRoster, SleeperTrendingRaw } from '@/lib/sleeper/types';
import { RouteCache, ROUTE_CACHE_TTL } from '@/lib/cache';
import type { WaiverSuggestion, WaiverSuggestionsResponse } from '@/types/suggestions';
import { ok, err } from '@/lib/api';
import MOCK_MATCHUP from '@/mock_data/matchup.json';
import MOCK_WAIVER  from '@/mock_data/waiver.json';

export type { WaiverSuggestion, WaiverSuggestionsResponse };

const IS_DEMO  = process.env.DEMO_MODE === 'true';
const DEMO_TTL = ROUTE_CACHE_TTL.DEMO;
const LIVE_TTL = ROUTE_CACHE_TTL.LIVE;

// ─── In-process cache ─────────────────────────────────────────────────────────

const cache = new RouteCache<WaiverSuggestionsResponse>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'] as const;
type SkillPos = (typeof SKILL_POSITIONS)[number];

function isSkillPos(p: string): p is SkillPos {
  return (SKILL_POSITIONS as readonly string[]).includes(p);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId')?.trim();
  const userId   = searchParams.get('userId')?.trim();

  if (!leagueId) return err('leagueId is required', 400);
  if (!userId)   return err('userId is required',   400);

  const cacheKey = IS_DEMO ? `demo-waiver-${leagueId}` : `${leagueId}-${userId}`;
  const TTL      = IS_DEMO ? DEMO_TTL : LIVE_TTL;
  const hit = cache.get(cacheKey, TTL);
  if (hit) return ok(hit);

  try {
    // ── Data-gathering phase (demo vs. live) ───────────────────────────────────

    type PlayerInfo  = { name: string; position: string; team: string | null; gsisId: string | null };
    type RosterEntry = { roster_id: number; owner_id: string | null; players: string[] | null };

    let myPlayerIds:   string[];
    let rosteredSet:   Set<string>;
    let availableIds:  string[];
    let trendingCount: Map<string, number>;
    let playerMap:     Map<string, PlayerInfo>;
    let mockAvgMap:    Map<string, number>;   // fallback pts when DB has no data
    let rosterList:    RosterEntry[];
    let season:        number;
    let week:          number;

    if (IS_DEMO) {
      // ── Demo branch ────────────────────────────────────────────────────────────
      // waiver.json uses Sleeper numeric IDs (e.g. "3321") as player IDs — the
      // same format live mode uses. This ensures SLEEPER_THUMB(id) resolves to
      // a valid CDN URL. A separate gsisId field (when present) is used for DB
      // headshot / stats lookups via the nflverse-populated NflWeeklyStat table.
      season        = await resolveSeason(searchParams.get('season'));
      week          = Math.floor(Math.random() * 17) + 1;
      trendingCount = new Map();
      mockAvgMap    = new Map();

      const team1 = MOCK_MATCHUP.team1.players;
      const team2 = MOCK_MATCHUP.team2.players;
      const pool  = MOCK_WAIVER.availablePlayers;

      myPlayerIds  = team1.map((p) => p.id);
      const t2Ids  = team2.map((p) => p.id);
      availableIds = pool.map((p) => p.id);
      rosteredSet  = new Set([...myPlayerIds, ...t2Ids]);

      // Build local player map.
      // Roster players (matchup.json) still carry GSIS IDs — those are only used
      // for pts-average calculation, not headshots, so the mismatch is harmless.
      playerMap = new Map<string, PlayerInfo>();
      for (const p of [...team1, ...team2]) {
        playerMap.set(p.id, { name: p.name, position: p.position, team: p.team, gsisId: p.id });
      }
      // Waiver pool uses Sleeper numeric IDs; gsisId (if present) enables DB headshot lookup.
      for (const p of pool) {
        const gsisId = (p as { gsisId?: string | null }).gsisId ?? null;
        playerMap.set(p.id, { name: p.name, position: p.position, team: p.team, gsisId });
        mockAvgMap.set(p.id, p.mockAvgPts);
      }

      // Two-team "league" for positional-median comparison
      rosterList = [
        { roster_id: 1, owner_id: userId,          players: myPlayerIds },
        { roster_id: 2, owner_id: 'demo-opponent', players: t2Ids       },
      ];

    } else {
      // ── Live branch: real Sleeper data ─────────────────────────────────────────
      season     = await resolveSeason(searchParams.get('season'));
      mockAvgMap = new Map();

      week = await resolveWeek(searchParams.get('week'), 'completed');

      const [rosters, trendingRaw, livePlayerMap] = await Promise.all([
        sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
        sleeperGet<SleeperTrendingRaw[]>('/players/nfl/trending/add?lookback_hours=168&limit=50', SLEEPER_TTL.TRENDING),
        getPlayerMapSafe(),
      ]);

      rosterList    = rosters;
      playerMap     = livePlayerMap;
      trendingCount = new Map(trendingRaw.map((t) => [t.player_id, t.count]));

      const myRoster = rosters.find((r) => r.owner_id === userId);
      if (!myRoster) {
        return err('Roster not found for this user', 404);
      }

      rosteredSet = new Set<string>();
      for (const r of rosters) {
        for (const pid of r.players ?? []) rosteredSet.add(pid);
      }

      myPlayerIds  = myRoster.players ?? [];
      availableIds = trendingRaw
        .filter((t) => !rosteredSet.has(t.player_id))
        .map((t) => t.player_id);
    }

    // ── Fetch stats from DB (last 3 weeks) ─────────────────────────────────────
    //
    // Every rostered player counts, not just mine: the positional-weakness test
    // below compares my best starter against the league median, which is zero
    // for everyone if the other nine rosters are never looked up.
    const allRelevantIds = [...new Set([
      ...rosterList.flatMap((r) => r.players ?? []),
      ...myPlayerIds,
      ...availableIds,
    ])];

    // ── Which season, and how far into it, the stat table can answer for ──────
    // Before kickoff the live season has no rows at all, so this falls back to
    // the last season that does and the panel reads last year's form rather than
    // a column of zeros. `statsWeek` does the same for the week: mid-season the
    // nflverse sync trails live play, and a window ending on a week that has not
    // landed yet would come back empty.
    const stats     = await resolveStatsSeason(season);
    // This league's rules — the stored PPR column is full PPR and scores kickers
    // and defenses at zero. See src/lib/scoring.ts.
    const scoring   = await getScoringSettings(leagueId);
    const statsWeek = stats.maxWeek > 0 ? Math.min(week, stats.maxWeek) : week;

    // ── Build the Sleeper → GSIS cross-reference ──────────────────────────────
    // NflWeeklyStat is keyed on GSIS IDs; everything above is keyed on Sleeper
    // IDs. Querying with the wrong ones returns no rows and reads as "nobody
    // scored", so the translation has to happen before either query. See
    // src/lib/sleeper/gsisXref.ts for why the Sleeper gsis_id field alone is not
    // enough live. Demo needs no special case: every mock player carries its own
    // gsisId, so this resolves from the map without a query.
    const xref = await buildGsisXref(allRelevantIds, playerMap, stats.season);

    const availableGsisIds = availableIds
      .map((pid) => xref.toGsis.get(pid))
      .filter((g): g is string => g != null);

    // ── Two parallel DB queries ────────────────────────────────────────────────
    // 1. Recent stats over the last 3 resolvable weeks — scoring/avg calculation.
    // 2. Season-wide headshot lookup for the waiver pool — the nflverse-sourced
    //    headshot URLs the component prefers over Sleeper's CDN.
    const [statsRows, headshotRows] = await Promise.all([
      xref.gsisIds.length > 0
        ? prisma.nflWeeklyStat.findMany({
            where: {
              season:     stats.season,
              // Regular season only: postseason weeks cover a shrinking subset
              // of players, so including them scores a non-playoff player's
              // absence as a zero game.
              seasonType: 'REG',
              week:       { lte: statsWeek, gt: Math.max(0, statsWeek - 3) },
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
    ]);

    // Per-player avg; demo falls back to mockAvgPts when DB has no rows.
    // Map headshots back from GSIS IDs → Sleeper IDs so the component can use them.
    const playerPoints   = new Map<string, number[]>();
    const playerHeadshot = new Map<string, string>(); // sleeperPlayerId → NFL CDN URL

    // Both queries came back keyed on GSIS IDs; everything downstream — rosters,
    // the waiver pool, the rendered rows — speaks Sleeper IDs, so map back here.
    for (const row of headshotRows) {
      const sleeperId = xref.toSleeper.get(row.playerId);
      if (sleeperId && row.headshot) playerHeadshot.set(sleeperId, row.headshot);
    }
    for (const row of statsRows) {
      const sleeperId = xref.toSleeper.get(row.playerId);
      if (!sleeperId) continue;
      const arr = playerPoints.get(sleeperId) ?? [];
      arr.push(scoreRow(row, scoring));
      playerPoints.set(sleeperId, arr);
    }

    function avg(pid: string): number {
      const pts = playerPoints.get(pid);
      if (!pts || pts.length === 0) return mockAvgMap.get(pid) ?? 0;
      return pts.reduce((a, b) => a + b, 0) / pts.length;
    }

    // ── Positional weakness (league-median comparison) ─────────────────────────

    const leagueStarterAvg: Record<string, number[]> = {};
    for (const roster of rosterList) {
      const byPos: Record<string, number[]> = {};
      for (const pid of roster.players ?? []) {
        const info = playerMap.get(pid);
        const pos  = info?.position;
        if (!pos || !isSkillPos(pos)) continue;
        const pts = avg(pid);
        if (!byPos[pos]) byPos[pos] = [];
        byPos[pos].push(pts);
      }
      for (const [pos, pts] of Object.entries(byPos)) {
        pts.sort((a, b) => b - a);
        if (!leagueStarterAvg[pos]) leagueStarterAvg[pos] = [];
        leagueStarterAvg[pos].push(pts[0] ?? 0); // top starter per team
      }
    }

    const leagueMedian: Record<string, number> = {};
    for (const [pos, vals] of Object.entries(leagueStarterAvg)) {
      const sorted = [...vals].sort((a, b) => a - b);
      leagueMedian[pos] = sorted[Math.floor(sorted.length / 2)] ?? 0;
    }

    const myByPos: Record<string, number[]> = {};
    for (const pid of myPlayerIds) {
      const info = playerMap.get(pid);
      const pos  = info?.position;
      if (!pos || !isSkillPos(pos)) continue;
      if (!myByPos[pos]) myByPos[pos] = [];
      myByPos[pos].push(avg(pid));
    }

    const weakPositions: string[] = [];
    for (const pos of SKILL_POSITIONS) {
      const myBest = Math.max(0, ...(myByPos[pos] ?? [0]));
      const median  = leagueMedian[pos] ?? 0;
      if (myBest < median * 0.85) weakPositions.push(pos); // >15% below league median
    }

    // ── Score & rank available players ────────────────────────────────────────

    type ScoredSuggestion = WaiverSuggestion & { _score: number };
    const suggestions: ScoredSuggestion[] = [];

    // Say which weeks the average covers. Naming the season matters only when it
    // is not the one being played — "last 3 wks" would otherwise imply this year.
    const windowLabel = stats.fallback
      ? `last 3 wks of ${stats.season}`
      : 'last 3 wks';

    for (const pid of availableIds) {
      const info = playerMap.get(pid);
      if (!info) continue;
      const pos  = info.position;
      if (!isSkillPos(pos)) continue;

      const recentAvg  = avg(pid);
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
        recentAvg, reason, trendingCount: trendCount, _score: score,
      });
    }

    suggestions.sort((a, b) => b._score - a._score);
    const top8: WaiverSuggestion[] = suggestions.slice(0, 8).map((s) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { _score: _ignored, ...rest } = s as any;
      void _ignored;
      return rest as WaiverSuggestion;
    });

    // Fallback for live mode when there's no DB data: sort by trending volume
    if (!IS_DEMO && top8.every((s) => s.recentAvg === 0)) {
      top8.sort((a, b) => (b.trendingCount ?? 0) - (a.trendingCount ?? 0));
    }

    const result: WaiverSuggestionsResponse = {
      weakPositions,
      suggestions: top8,
      statsSeason:   stats.season,
      statsFallback: stats.fallback,
      ...(IS_DEMO && { demo: true }),
    };
    cache.set(cacheKey, result);
    return ok(result);

  } catch (error) {
    const msg    = error instanceof Error ? error.message : 'Upstream error';
    const status = msg.includes('404') ? 404 : 502;
    return err(msg, status);
  }
}
