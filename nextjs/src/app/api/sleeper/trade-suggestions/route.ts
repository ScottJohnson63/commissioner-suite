// src/app/api/sleeper/trade-suggestions/route.ts
//
// Identifies mutually beneficial trade opportunities by comparing every team's
// positional surplus and deficit, then surfaces balanced proposals.
//
// GET /api/sleeper/trade-suggestions?leagueId=&userId=&season=
//
// DEMO_MODE=true: bypasses Sleeper API, uses both rosters from
//   src/mock_data/matchup.json as a two-team "league". Season totals are
//   queried from the DB using real GSIS IDs; DEMO_SEASON_PTS provides
//   realistic fallbacks when the DB has no data for a player.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPlayerMapSafe } from '@/lib/sleeper/playerCache';
import { resolveTeamName } from '@/lib/sleeper/teams';
import { resolveSeason } from '@/lib/sleeper/week';
import { resolveStatsSeason } from '@/lib/statsSeason';
import { buildGsisXref } from '@/lib/sleeper/gsisXref';
import { getScoringSettings } from '@/lib/sleeper/scoringSettings';
import { scoreRow, STAT_LINE_SELECT } from '@/lib/scoring';
import { sleeperGet } from '@/lib/sleeper/client';
import type { SleeperRoster, SleeperUser } from '@/lib/sleeper/types';
import { RouteCache, ROUTE_CACHE_TTL } from '@/lib/cache';
import type { TradePlayer, TradeProposal, TradeSuggestionsResponse } from '@/types/suggestions';
import { ok, err } from '@/lib/api';
import MOCK_MATCHUP from '@/mock_data/matchup.json';

export type { TradePlayer, TradeProposal, TradeSuggestionsResponse };

const IS_DEMO  = process.env.DEMO_MODE === 'true';
const DEMO_TTL = ROUTE_CACHE_TTL.DEMO;
const LIVE_TTL = ROUTE_CACHE_TTL.LIVE;

// ─── Fallback season totals for demo (used when DB returns 0 for a player) ───

const DEMO_SEASON_PTS: Record<string, number> = {
  // Alpha Squad (team1)
  '00-0034796': 385.2, // Lamar Jackson
  '00-0034844': 295.8, // Saquon Barkley
  '00-0039139': 261.4, // Jahmyr Gibbs
  '00-0039040': 238.6, // De'Von Achane
  '00-0036900': 278.3, // Ja'Marr Chase
  '00-0036963': 252.1, // Amon-Ra St. Brown
  '00-0039893': 198.7, // Brian Thomas Jr.
  '00-0039337': 187.4, // Malik Nabers
  '00-0030506': 221.8, // Travis Kelce
  '00-0033288': 208.9, // George Kittle
  '00-0029597': 135.2, // Justin Tucker
  // Beta Force (team2)
  '00-0034857': 402.6, // Josh Allen
  '00-0032764': 278.1, // Derrick Henry
  '00-0038542': 243.5, // Bijan Robinson
  '00-0035700': 201.8, // Josh Jacobs
  '00-0036322': 269.4, // Justin Jefferson
  '00-0036358': 258.7, // CeeDee Lamb
  '00-0033906': 187.3, // Alvin Kamara
  '00-0037248': 164.2, // James Cook
  '00-0039338': 198.4, // Brock Bowers
  '00-0034753': 183.6, // Mark Andrews
  '00-0031136': 128.9, // Chris Boswell
};

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new RouteCache<TradeSuggestionsResponse>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'] as const;
type Pos = (typeof POSITIONS)[number];

function isPos(p: string): p is Pos {
  return (POSITIONS as readonly string[]).includes(p);
}

/**
 * Computes a trade fairness score from 0–100.
 * 100 = perfectly balanced (equal season points on both sides).
 * Scores below 60 are filtered out as too lopsided to recommend.
 *
 * Formula: 100 − (100 × |give − receive| / max(give, receive, 1))
 */
function fairness(givePts: number, receivePts: number): number {
  const denom = Math.max(givePts, receivePts, 1);
  return Math.max(0, Math.min(100, 100 - (100 * Math.abs(givePts - receivePts)) / denom));
}

/**
 * Generates a one-sentence human-readable summary of a trade proposal.
 * If both sides involve the same position, describes it as a like-for-like
 * upgrade; otherwise describes it as trading depth for a starter at a
 * different position.
 */
function buildSummary(give: TradePlayer[], receive: TradePlayer[]): string {
  const givePos    = [...new Set(give.map((p) => p.position))].join('/');
  const receivePos = [...new Set(receive.map((p) => p.position))].join('/');
  if (givePos === receivePos) return `Upgrade your ${givePos} with a like-for-like swap`;
  return `Trade ${givePos} depth for their ${receivePos} starter`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId')?.trim();
  const userId   = searchParams.get('userId')?.trim();

  if (!leagueId) return err('leagueId is required', 400);
  if (!userId)   return err('userId is required',   400);

  const cacheKey = IS_DEMO ? `demo-trade-${leagueId}` : `${leagueId}-${userId}`;
  const TTL      = IS_DEMO ? DEMO_TTL : LIVE_TTL;
  const hit = cache.get(cacheKey, TTL);
  if (hit) return ok(hit);

  try {
    // ── Data-gathering phase (demo vs. live) ───────────────────────────────────

    type PlayerInfo = { name: string; position: string; team: string | null; gsisId: string | null };

    let rosters:      SleeperRoster[];
    let teamNameMap:  Map<string, string>;
    let playerMap:    Map<string, PlayerInfo>;
    let seasonPtsMap: Map<string, number>;
    // GSIS ID → Sleeper numeric ID for CDN image resolution (populated in demo mode)
    const gsisToSleeperIdMap = new Map<string, string>();

    const season = await resolveSeason(searchParams.get('season'));

    // Which season the totals actually come from. Fairness is scored on season
    // points, so before kickoff — when the live season has no rows — the honest
    // baseline is last season's totals rather than a roster of zeroes, which
    // would score every proposal as perfectly balanced.
    const { season: statsSeason, fallback: statsFallback } =
      await resolveStatsSeason(season);

    // Totals are summed here rather than by the database. A SQL SUM can only add
    // a stored column, and the stored one is full PPR with kickers at zero and
    // no defenses — so each week is scored under this league's own rules first.
    const scoring = await getScoringSettings(leagueId);

    /**
     * Season points per player, summed from weekly rows under `scoring`.
     *
     * @param ids  Stat-table player IDs — GSIS IDs, or team codes for defenses.
     * @returns    Points keyed by the same IDs; callers map them back themselves.
     */
    async function seasonTotals(ids: string[]): Promise<Map<string, number>> {
      const totals = new Map<string, number>();
      if (ids.length === 0) return totals;

      const rows = await prisma.nflWeeklyStat.findMany({
        // Regular season only: postseason points accrue to players whose team
        // went deep, which is not a measure of trade value.
        where:  { season: statsSeason, seasonType: 'REG', playerId: { in: ids } },
        select: { playerId: true, ...STAT_LINE_SELECT },
      });
      for (const row of rows) {
        totals.set(row.playerId, (totals.get(row.playerId) ?? 0) + scoreRow(row, scoring));
      }
      return totals;
    }

    if (IS_DEMO) {
      // ── Demo branch ───────────────────────────────────────────────────────────

      const team1 = MOCK_MATCHUP.team1;
      const team2 = MOCK_MATCHUP.team2;

      teamNameMap = new Map([
        [userId,            team1.name],
        ['demo-opponent',   team2.name],
      ]);

      rosters = [
        {
          roster_id: team1.rosterId,
          owner_id:  userId,
          players:   team1.players.map((p) => p.id),
          settings:  { wins: 5, losses: 4, fpts: 0, fpts_decimal: 0 },
        },
        {
          roster_id: team2.rosterId,
          owner_id:  'demo-opponent',
          players:   team2.players.map((p) => p.id),
          settings:  { wins: 6, losses: 3, fpts: 0, fpts_decimal: 0 },
        },
      ];

      // Build player map + GSIS → Sleeper ID reverse map from mock data
      playerMap = new Map<string, PlayerInfo>();
      for (const p of [...team1.players, ...team2.players]) {
        playerMap.set(p.id, { name: p.name, position: p.position, team: p.team, gsisId: null });
        const sid = (p as { sleeperId?: string }).sleeperId;
        if (sid) gsisToSleeperIdMap.set(p.id, sid);
      }

      // Season totals: query DB with GSIS IDs, fall back to mock values
      const allIds = [...team1.players, ...team2.players].map((p) => p.id);
      seasonPtsMap = new Map<string, number>();

      for (const [pid, pts] of await seasonTotals(allIds)) {
        if (pts > 0) seasonPtsMap.set(pid, pts);
      }
      // Fill gaps with curated mock fallbacks
      for (const [pid, pts] of Object.entries(DEMO_SEASON_PTS)) {
        if (!seasonPtsMap.has(pid) || (seasonPtsMap.get(pid) ?? 0) === 0) {
          seasonPtsMap.set(pid, pts);
        }
      }

    } else {
      // ── Live branch ────────────────────────────────────────────────────────────
      const [liveRosters, users, livePlayerMap] = await Promise.all([
        sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
        sleeperGet<SleeperUser[]>(`/league/${leagueId}/users`),
        getPlayerMapSafe(),
      ]);

      rosters   = liveRosters;
      playerMap = livePlayerMap;

      teamNameMap = new Map<string, string>();
      for (const u of users) {
        teamNameMap.set(u.user_id, resolveTeamName(u, u.user_id));
      }

      // ── Season totals from the DB ──────────────────────────────────────────
      // Rosters speak Sleeper IDs and NflWeeklyStat is keyed on GSIS IDs, so the
      // totals have to be looked up through the cross-reference and mapped back.
      // Querying with the Sleeper IDs directly returns nothing, which reads as
      // every player having scored zero — and a trade between two rosters of
      // zeroes scores as perfectly fair.
      const allPlayerIds = [...new Set(liveRosters.flatMap((r) => r.players ?? []))];
      seasonPtsMap = new Map<string, number>();
      if (allPlayerIds.length > 0) {
        const xref = await buildGsisXref(allPlayerIds, livePlayerMap, statsSeason);
        for (const [statId, pts] of await seasonTotals(xref.gsisIds)) {
          const sleeperId = xref.toSleeper.get(statId);
          if (sleeperId) seasonPtsMap.set(sleeperId, pts);
        }
      }
    }

    // ── Shared analysis ────────────────────────────────────────────────────────

    const myRoster = rosters.find((r) => r.owner_id === userId);
    if (!myRoster) {
      return err('Roster not found for this user', 404);
    }

    // For each team: find their best player per position
    interface TeamPosBest { ownerId: string; playerId: string; pts: number }
    const posBest: Record<Pos, TeamPosBest[]> = { QB: [], RB: [], WR: [], TE: [], K: [] };

    for (const roster of rosters) {
      if (!roster.owner_id) continue;
      const byPos: Partial<Record<Pos, { pid: string; pts: number }[]>> = {};
      for (const pid of roster.players ?? []) {
        const info = playerMap.get(pid);
        const pos  = info?.position;
        if (!pos || !isPos(pos)) continue;
        if (!byPos[pos]) byPos[pos] = [];
        byPos[pos]!.push({ pid, pts: seasonPtsMap.get(pid) ?? 0 });
      }
      for (const pos of POSITIONS) {
        const sorted = (byPos[pos] ?? []).sort((a, b) => b.pts - a.pts);
        if (sorted.length > 0) {
          posBest[pos].push({ ownerId: roster.owner_id, playerId: sorted[0].pid, pts: sorted[0].pts });
        }
      }
    }

    // User's position ranks (1 = best in league)
    const myPositionRanks: Record<string, number> = {};
    for (const pos of POSITIONS) {
      const sorted = [...posBest[pos]].sort((a, b) => b.pts - a.pts);
      const rank   = sorted.findIndex((e) => e.ownerId === userId) + 1;
      if (rank > 0) myPositionRanks[pos] = rank;
    }

    const leagueSize = rosters.filter((r) => r.owner_id).length;
    const midpoint   = Math.ceil(leagueSize / 2);

    const mySurplusPos = POSITIONS.filter((p) => (myPositionRanks[p] ?? 999) <= 3);
    const myDeficitPos = POSITIONS.filter((p) => (myPositionRanks[p] ?? 999) > midpoint);

    // Build trade proposals against each other team
    const proposals: TradeProposal[] = [];

    function topPlayerForPos(
      rosterObj: SleeperRoster,
      pos: Pos,
      exclude: Set<string>,
    ): TradePlayer | null {
      const candidates = (rosterObj.players ?? [])
        .filter((pid) => {
          const info = playerMap.get(pid);
          return info?.position === pos && !exclude.has(pid);
        })
        .map((pid) => ({ pid, pts: seasonPtsMap.get(pid) ?? 0 }))
        .sort((a, b) => b.pts - a.pts);
      if (candidates.length === 0) return null;
      const { pid, pts } = candidates[0];
      const info = playerMap.get(pid);
      if (!info) return null;
      // In demo mode pid is a GSIS ID; map to Sleeper numeric ID for CDN images.
      // In live mode pid is already the Sleeper ID so the map is empty and pid is used.
      const sleeperPlayerId = gsisToSleeperIdMap.get(pid) ?? pid;
      return { playerId: pid, sleeperPlayerId, name: info.name, position: pos, seasonPts: pts };
    }

    for (const otherRoster of rosters) {
      if (!otherRoster.owner_id || otherRoster.owner_id === userId) continue;
      const otherOwner = otherRoster.owner_id;

      const otherPosRanks: Record<string, number> = {};
      for (const pos of POSITIONS) {
        const sorted = [...posBest[pos]].sort((a, b) => b.pts - a.pts);
        const rank   = sorted.findIndex((e) => e.ownerId === otherOwner) + 1;
        if (rank > 0) otherPosRanks[pos] = rank;
      }

      const theirSurplusAtMyDeficit = myDeficitPos.filter((p) => (otherPosRanks[p] ?? 999) <= 3);
      const theirDeficitAtMySurplus = mySurplusPos.filter((p) => (otherPosRanks[p] ?? 999) > midpoint);

      if (theirSurplusAtMyDeficit.length === 0 || theirDeficitAtMySurplus.length === 0) continue;

      for (const receivePos of theirSurplusAtMyDeficit) {
        for (const givePos of theirDeficitAtMySurplus) {
          const receivePlayer = topPlayerForPos(otherRoster, receivePos as Pos, new Set());
          const givePlayer    = topPlayerForPos(myRoster,    givePos    as Pos, new Set());
          if (!receivePlayer || !givePlayer) continue;

          const score = fairness(givePlayer.seasonPts, receivePlayer.seasonPts);
          if (score < 60) continue;

          proposals.push({
            targetTeamName: teamNameMap.get(otherOwner) ?? `Roster ${otherRoster.roster_id}`,
            targetOwnerId:  otherOwner,
            give:           [givePlayer],
            receive:        [receivePlayer],
            fairnessScore:  score,
            summary:        buildSummary([givePlayer], [receivePlayer]),
          });
        }
      }
    }

    // Deduplicate and sort
    proposals.sort((a, b) => b.fairnessScore - a.fairnessScore);
    const seen    = new Set<string>();
    const deduped = proposals
      .filter((p) => {
        const key = `${p.give[0]?.playerId}-${p.receive[0]?.playerId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);

    const result: TradeSuggestionsResponse = {
      myPositionRanks,
      proposals: deduped,
      statsSeason,
      statsFallback,
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
