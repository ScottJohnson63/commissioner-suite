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
import { getPlayerMap } from '@/lib/sleeper/playerCache';
import { sleeperGet } from '@/lib/sleeper/client';
import type { SleeperRoster, SleeperNflState, SleeperTrendingRaw } from '@/lib/sleeper/types';
import { RouteCache } from '@/lib/cache';
import type { WaiverSuggestion, WaiverSuggestionsResponse } from '@/types/suggestions';
import { ok, err } from '@/lib/api';
import MOCK_MATCHUP from '@/mock_data/matchup.json';
import MOCK_WAIVER  from '@/mock_data/waiver.json';

export type { WaiverSuggestion, WaiverSuggestionsResponse };

const IS_DEMO  = process.env.DEMO_MODE === 'true';
const DEMO_TTL = 60 * 1_000;      // 1 min — short so re-clicking after a min picks a new random week
const LIVE_TTL = 10 * 60 * 1_000; // 10 min

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

    type PlayerInfo  = { name: string; position: string; team: string | null };
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
      // ── Demo branch: fixed mock rosters, real GSIS IDs, random past week ──────
      season        = Number(process.env.NFL_SEASON ?? '2025');
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

      // Build local player map + mock fallback points
      playerMap = new Map<string, PlayerInfo>();
      for (const p of [...team1, ...team2]) {
        playerMap.set(p.id, { name: p.name, position: p.position, team: p.team });
      }
      for (const p of pool) {
        playerMap.set(p.id, { name: p.name, position: p.position, team: p.team });
        mockAvgMap.set(p.id, p.mockAvgPts);
      }

      // Two-team "league" for positional-median comparison
      rosterList = [
        { roster_id: 1, owner_id: userId,          players: myPlayerIds },
        { roster_id: 2, owner_id: 'demo-opponent', players: t2Ids       },
      ];

    } else {
      // ── Live branch: real Sleeper data ─────────────────────────────────────────
      season     = Number(searchParams.get('season') ?? '2025');
      mockAvgMap = new Map();

      let rawWeek = searchParams.get('week') ? Number(searchParams.get('week')) : null;
      if (!rawWeek) {
        try {
          const state = await sleeperGet<SleeperNflState>('/state/nfl', 60);
          rawWeek = Math.max(1, state.week - 1);
        } catch { rawWeek = 1; }
      }
      week = rawWeek;

      const [rosters, trendingRaw, livePlayerMap] = await Promise.all([
        sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
        sleeperGet<SleeperTrendingRaw[]>('/players/nfl/trending/add?lookback_hours=168&limit=50', 600),
        getPlayerMap().catch(() => new Map<string, PlayerInfo>()),
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

    const allRelevantIds = [...new Set([...myPlayerIds, ...availableIds])];

    let statsRows: { playerId: string; fantasyPointsPpr: number | null; position: string | null }[] = [];
    if (allRelevantIds.length > 0) {
      statsRows = await prisma.nflWeeklyStat.findMany({
        where: {
          season,
          week:     { lte: week, gt: Math.max(0, week - 3) },
          playerId: { in: allRelevantIds },
        },
        select: { playerId: true, fantasyPointsPpr: true, position: true },
      });
    }

    // Per-player avg; demo falls back to mockAvgPts when DB has no rows
    const playerPoints = new Map<string, number[]>();
    for (const row of statsRows) {
      if (row.fantasyPointsPpr === null) continue;
      const arr = playerPoints.get(row.playerId) ?? [];
      arr.push(row.fantasyPointsPpr);
      playerPoints.set(row.playerId, arr);
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
        ? `Addresses ${pos} weakness — ${recentAvg.toFixed(1)} pts avg last 3 wks`
        : `Strong recent form — ${recentAvg.toFixed(1)} pts avg last 3 wks${trendCount ? ` · ${trendCount.toLocaleString()} adds` : ''}`;

      suggestions.push({
        playerId: pid, name: info.name, position: pos, team: info.team,
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
