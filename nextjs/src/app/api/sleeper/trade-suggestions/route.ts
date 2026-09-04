// src/app/api/sleeper/trade-suggestions/route.ts
//
// Identifies mutually beneficial trade opportunities by reading every roster as
// a depth chart, then surfacing the deals that improve both starting lineups.
//
// The pieces each side offers come from its own surplus rather than the top of
// its best position, so the same void produces several different proposals —
// see src/lib/tradeFinder.ts for why the best player at a position is almost
// never the right one to trade.
//
// GET /api/sleeper/trade-suggestions?leagueId=&userId=&season=

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPlayerMapSafe } from '@/lib/sleeper/playerCache';
import { resolveTeamName } from '@/lib/sleeper/teams';
import { resolveSeason } from '@/lib/sleeper/week';
import { resolveStatsSeason } from '@/lib/statsSeason';
import { buildGsisXref } from '@/lib/sleeper/gsisXref';
import { getScoringSettings } from '@/lib/sleeper/scoringSettings';
import { getStarterSlots } from '@/lib/sleeper/lineup';
import { scoreRow, STAT_LINE_SELECT } from '@/lib/scoring';
import { sleeperGet } from '@/lib/sleeper/client';
import type { SleeperRoster, SleeperUser } from '@/lib/sleeper/types';
import { RouteCache, ROUTE_CACHE_TTL } from '@/lib/cache';
import {
  TRADE_POSITIONS, isTradePos, buildRosterShape, findTrades, describeTrade,
  positionStrength, countUpgrades,
} from '@/lib/tradeFinder';
import type { DepthPlayer, RosterEntry, RosterShape } from '@/lib/tradeFinder';
import type { TradePlayer, TradeProposal, TradeSuggestionsResponse } from '@/types/suggestions';
import { ok, err } from '@/lib/api';

export type { TradePlayer, TradeProposal, TradeSuggestionsResponse };

const LIVE_TTL = ROUTE_CACHE_TTL.LIVE;

/** Proposals returned — what the panel shows. */
const MAX_PROPOSALS = 5;

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new RouteCache<TradeSuggestionsResponse>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A depth-chart player as the panel wants him.
 *
 * `cost` stays server-side: it is the reason the finder picked this player, and
 * `describeTrade` has already said it in words the panel can print.
 */
function toTradePlayer(p: DepthPlayer): TradePlayer {
  return {
    // The roster ID is already the Sleeper ID, which is what CDN headshots key on.
    playerId:        p.playerId,
    sleeperPlayerId: p.playerId,
    name:            p.name,
    position:        p.position,
    seasonPts:       p.seasonPts,
    depthRank:       p.depthRank,
    starter:         p.starter,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId')?.trim();
  const userId   = searchParams.get('userId')?.trim();

  if (!leagueId) return err('leagueId is required', 400);
  if (!userId)   return err('userId is required',   400);

  const cacheKey = `${leagueId}-${userId}`;
  const hit = cache.get(cacheKey, LIVE_TTL);
  if (hit) return ok(hit);

  try {
    // ── Data-gathering phase ───────────────────────────────────────────────────

    type PlayerInfo = { name: string; position: string; team: string | null; gsisId: string | null };

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

    // How many players this league starts at each position — the line that
    // separates a roster's surplus from the lineup it has to field.
    const starterSlots = await getStarterSlots(leagueId);

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

    const [liveRosters, users, livePlayerMap] = await Promise.all([
      sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
      sleeperGet<SleeperUser[]>(`/league/${leagueId}/users`),
      getPlayerMapSafe(),
    ]);

    const rosters: SleeperRoster[]            = liveRosters;
    const playerMap: Map<string, PlayerInfo>  = livePlayerMap;

    const teamNameMap = new Map<string, string>();
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
    const seasonPtsMap = new Map<string, number>();
    if (allPlayerIds.length > 0) {
      const xref = await buildGsisXref(allPlayerIds, livePlayerMap, statsSeason);
      for (const [statId, pts] of await seasonTotals(xref.gsisIds)) {
        const sleeperId = xref.toSleeper.get(statId);
        if (sleeperId) seasonPtsMap.set(sleeperId, pts);
      }
    }

    // ── Depth charts ───────────────────────────────────────────────────────────

    const shapes: RosterShape[] = [];
    for (const roster of rosters) {
      if (!roster.owner_id) continue;
      const entries: RosterEntry[] = [];
      for (const pid of roster.players ?? []) {
        const info = playerMap.get(pid);
        if (!info || !isTradePos(info.position)) continue;
        entries.push({
          playerId:  pid,
          name:      info.name,
          position:  info.position,
          seasonPts: seasonPtsMap.get(pid) ?? 0,
        });
      }
      shapes.push(buildRosterShape(roster.owner_id, entries, starterSlots));
    }

    const myShape = shapes.find((s) => s.ownerId === userId);
    if (!myShape) {
      return err('Roster not found for this user', 404);
    }

    // ── Where I stand, position by position ────────────────────────────────────
    // Ranked on the whole starting group rather than the single best player: a
    // league that starts two running backs is not described by anyone's RB1, and
    // an elite RB1 with nothing behind him used to read as strength at the exact
    // position this roster most needs to fill.
    const myPositionRanks: Record<string, number> = {};
    for (const pos of TRADE_POSITIONS) {
      const strengths = shapes.map((s) => ({
        ownerId: s.ownerId,
        pts:     positionStrength(s, pos, starterSlots),
      }));
      // A position nobody in the league rosters is not a ranking, it is a gap in
      // the player map. Reporting "#1" for it would be a badge for owning nothing.
      if (strengths.every((s) => s.pts === 0)) continue;
      strengths.sort((a, b) => b.pts - a.pts);
      const rank = strengths.findIndex((s) => s.ownerId === userId) + 1;
      if (rank > 0) myPositionRanks[pos] = rank;
    }

    // ── Proposals ──────────────────────────────────────────────────────────────

    const rosterIdByOwner = new Map<string, number>();
    for (const r of rosters) if (r.owner_id) rosterIdByOwner.set(r.owner_id, r.roster_id);

    const proposals: TradeProposal[] = findTrades(myShape, shapes, starterSlots, MAX_PROPOSALS)
      .map((c) => ({
        targetTeamName: teamNameMap.get(c.targetOwnerId)
                        ?? `Roster ${rosterIdByOwner.get(c.targetOwnerId) ?? '?'}`,
        targetOwnerId:  c.targetOwnerId,
        give:           c.give.map(toTradePlayer),
        receive:        c.receive.map(toTradePlayer),
        fairnessScore:  c.fairnessScore,
        lineupGain:     Math.round(c.myGain * 10) / 10,
        theirLineupGain: Math.round(c.theirGain * 10) / 10,
        acceptance:     c.acceptance,
        summary:        describeTrade(c),
      }));

    // ── Why an empty list is empty ─────────────────────────────────────────────
    // Three different situations produce no proposals and only one of them is
    // about trades. Reported separately because the panel's one message — "no
    // fair trades found, try again after more games" — is wrong advice for two
    // of them: it reads as a quiet failure when the stat table is empty, and as
    // false hope when the roster is already the best in the league everywhere.
    const scoredPlayers     = [...seasonPtsMap.values()].filter((pts) => pts > 0).length;
    const upgradesAvailable = countUpgrades(myShape, shapes, starterSlots);
    const noTradesReason: TradeSuggestionsResponse['noTradesReason'] =
      proposals.length > 0    ? undefined
      : scoredPlayers === 0   ? 'no-stats'
      : upgradesAvailable === 0 ? 'no-upgrades'
      :                         'no-fit';

    const result: TradeSuggestionsResponse = {
      myPositionRanks,
      starterSlots,
      proposals,
      scoredPlayers,
      upgradesAvailable,
      noTradesReason,
      statsSeason,
      statsFallback,
    };
    cache.set(cacheKey, result);
    return ok(result);

  } catch (error) {
    const msg    = error instanceof Error ? error.message : 'Upstream error';
    const status = msg.includes('404') ? 404 : 502;
    return err(msg, status);
  }
}
