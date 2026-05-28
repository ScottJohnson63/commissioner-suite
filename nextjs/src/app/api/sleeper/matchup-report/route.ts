// src/app/api/sleeper/matchup-report/route.ts
//
// Projects floor/ceiling for both sides of the user's current-week matchup.
// Enriches with:
//   • Defensive strength  (from local NflWeeklyStat DB)
//   • Weather forecasts   (Open-Meteo — free, no key)
//   • Vegas/live odds     (The Odds API — needs ODDS_API_KEY env var)
//
// GET /api/sleeper/matchup-report?leagueId=&userId=&season=&week=
//
// ── DEMO_MODE ─────────────────────────────────────────────────────────────────
// Set DEMO_MODE=true in .env to bypass the Sleeper matchup endpoint entirely.
// The route loads two dummy rosters from src/mock_data/matchup.json, picks a
// random regular-season week from NFL_SEASON, calls the real weather API for
// outdoor stadiums, and fetches live odds from whatever sport is currently
// in-season (NBA, MLB, NHL … — not limited to NFL).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPlayerMap, type SleeperPlayerInfo } from '@/lib/sleeper/playerCache';
import { sleeperGet } from '@/lib/sleeper/client';
import type { SleeperRoster, SleeperUser, SleeperMatchupRaw, SleeperNflState } from '@/lib/sleeper/types';
import { RouteCache } from '@/lib/cache';
import type { PlayerProjection, TeamProjection, WeatherInfo, VegasLine, MatchupReportResponse } from '@/types/projections';
import { STADIUM_COORDS } from '@/lib/stadiums';
import { stdDev } from '@/lib/math';
import { getWeather } from '@/lib/weather';
import { getLiveOdds, getNflOdds } from '@/lib/odds';
import { ok, err } from '@/lib/api';
import MOCK_MATCHUP from '@/mock_data/matchup.json';

export type { PlayerProjection, TeamProjection, WeatherInfo, VegasLine, MatchupReportResponse };

/**
 * true when DEMO_MODE=true is set in the environment.
 * In demo mode, mock rosters are used instead of live Sleeper data so the
 * feature can be demonstrated without a real Sleeper league.
 */
const IS_DEMO = process.env.DEMO_MODE === 'true';

// ─── Mock data types (used only when IS_DEMO) ─────────────────────────────────

interface MockPlayer { id: string; sleeperId?: string; name: string; position: string; team: string }
interface MockRoster { name: string; rosterId: number; players: MockPlayer[] }
const mockData = MOCK_MATCHUP as unknown as { team1: MockRoster; team2: MockRoster };

// ─── Caches ───────────────────────────────────────────────────────────────────

const matchupCache = new RouteCache<MatchupReportResponse>();

const MATCHUP_TTL = 15 * 60 * 1000; // 15 min
const DEMO_TTL    =      60 * 1000; // 1 min  (short so random week refreshes quickly)

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId')?.trim();
  const userId   = searchParams.get('userId')?.trim();

  if (!leagueId) return err('leagueId is required', 400);
  if (!userId)   return err('userId is required',   400);

  // ── Check response cache ───────────────────────────────────────────────────
  // Demo uses a short TTL so repeated clicks cycle through different random weeks.
  const cacheKey = IS_DEMO
    ? `demo-${leagueId}`
    : `${leagueId}-${userId}-${searchParams.get('week') ?? 'cur'}`;
  const cacheTTL  = IS_DEMO ? DEMO_TTL : MATCHUP_TTL;
  const cached = matchupCache.get(cacheKey, cacheTTL);
  if (cached) return ok(cached);

  try {
    // ── Variables set differently between demo and live ──────────────────────
    let myPlayerIds:  string[];
    let oppPlayerIds: string[];
    let myName:       string;
    let oppName:      string;
    let myRosterId:   number;
    let oppRosterId:  number;
    let effectiveSeason: number;
    let effectiveWeek:   number;
    let localPlayerMap:  Map<string, SleeperPlayerInfo>;
    // GSIS ID → Sleeper numeric ID (populated in demo mode for CDN image resolution)
    const gsisToSleeperIdMap = new Map<string, string>();

    if (IS_DEMO) {
      // ── DEMO: load mock rosters, pick random regular-season week ─────────
      effectiveSeason = Number(process.env.NFL_SEASON ?? '2025');
      effectiveWeek   = Math.floor(Math.random() * 17) + 1; // weeks 1-17

      myPlayerIds  = mockData.team1.players.map((p) => p.id);
      oppPlayerIds = mockData.team2.players.map((p) => p.id);
      myName       = mockData.team1.name;
      oppName      = mockData.team2.name;
      myRosterId   = mockData.team1.rosterId;
      oppRosterId  = mockData.team2.rosterId;

      // Build a local player map from the mock roster so we don't hit Sleeper
      localPlayerMap = new Map<string, SleeperPlayerInfo>();
      for (const p of [...mockData.team1.players, ...mockData.team2.players]) {
        localPlayerMap.set(p.id, { name: p.name, position: p.position, team: p.team, gsisId: p.id });
        if (p.sleeperId) gsisToSleeperIdMap.set(p.id, p.sleeperId);
      }
    } else {
      // ── LIVE: resolve from Sleeper API ────────────────────────────────────
      effectiveSeason = Number(searchParams.get('season') ?? '2025');
      let rawWeek = searchParams.get('week') ? Number(searchParams.get('week')) : null;
      if (!rawWeek) {
        try {
          const state = await sleeperGet<SleeperNflState>('/state/nfl', 60);
          rawWeek = state.week;
        } catch {
          rawWeek = 1;
        }
      }
      effectiveWeek = rawWeek;

      const [rosters, users, matchupsRaw, playerMapFull] = await Promise.all([
        sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
        sleeperGet<SleeperUser[]>(`/league/${leagueId}/users`),
        sleeperGet<SleeperMatchupRaw[]>(`/league/${leagueId}/matchups/${effectiveWeek}`),
        getPlayerMap().catch(() => new Map<string, SleeperPlayerInfo>()),
      ]);
      localPlayerMap = playerMapFull;

      const teamNameOf = (ownerId: string | null) => {
        if (!ownerId) return 'Unknown';
        const u = users.find((u) => u.user_id === ownerId);
        return u?.metadata?.team_name?.trim() || u?.display_name || 'Unknown';
      };

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

      myPlayerIds  = myRoster.players ?? [];
      oppPlayerIds = oppRoster?.players ?? [];
      myName       = teamNameOf(myRoster.owner_id);
      oppName      = teamNameOf(oppRoster?.owner_id ?? null);
      myRosterId   = myRoster.roster_id;
      oppRosterId  = oppRoster?.roster_id ?? 0;
    }

    // ── Build player stats (shared) ──────────────────────────────────────────
    const allIds      = [...new Set([...myPlayerIds, ...oppPlayerIds])];
    const completedWk = Math.max(1, effectiveWeek - 1);
    const sinceWk     = Math.max(1, completedWk - 5);

    let statsRows: { playerId: string; week: number; fantasyPointsPpr: number | null }[] = [];
    if (allIds.length > 0) {
      statsRows = await prisma.nflWeeklyStat.findMany({
        where: {
          season:   effectiveSeason,
          playerId: { in: allIds },
          week:     { gte: sinceWk, lte: completedWk },
        },
        select: { playerId: true, week: true, fantasyPointsPpr: true },
      });
    }

    const playerWeeklyPts = new Map<string, number[]>();
    for (const row of statsRows) {
      if (row.fantasyPointsPpr === null) continue;
      const arr = playerWeeklyPts.get(row.playerId) ?? [];
      arr.push(row.fantasyPointsPpr);
      playerWeeklyPts.set(row.playerId, arr);
    }

    // ── Defensive strength ───────────────────────────────────────────────────
    const defRows = await prisma.nflWeeklyStat.groupBy({
      by:    ['opponentTeam', 'position'],
      where: { season: effectiveSeason, opponentTeam: { not: null }, fantasyPointsPpr: { not: null } },
      _avg:  { fantasyPointsPpr: true },
    });

    const leagueAvgByPos = new Map<string, number[]>();
    const defAllowed     = new Map<string, number>(); // "TEAM-POS" → avg pts allowed
    for (const row of defRows) {
      const key = `${row.opponentTeam}-${row.position}`;
      defAllowed.set(key, row._avg.fantasyPointsPpr ?? 0);
      const arr = leagueAvgByPos.get(row.position ?? '') ?? [];
      arr.push(row._avg.fantasyPointsPpr ?? 0);
      leagueAvgByPos.set(row.position ?? '', arr);
    }

    /** Returns the mean fantasy points allowed to the given position across all defenses. */
    function leagueAvgForPos(pos: string): number {
      const arr = leagueAvgByPos.get(pos);
      if (!arr || arr.length === 0) return 0;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    }
    /**
     * Returns a defensive adjustment multiplier (0.85–1.15) for the given
     * position against the given opponent. Above 1 = soft defense (more points
     * expected); below 1 = stiff defense (fewer points expected).
     * Returns 1 when no defensive data is available.
     */
    function defAdjMultiplier(opponentTeam: string | null, pos: string): number {
      if (!opponentTeam) return 1;
      const allowed = defAllowed.get(`${opponentTeam}-${pos}`);
      const avg     = leagueAvgForPos(pos);
      if (!allowed || avg === 0) return 1;
      return Math.max(0.85, Math.min(1.15, allowed / avg));
    }

    // ── Weather (always calls the real Open-Meteo API) ───────────────────────
    const outdoorTeams = new Set<string>();
    for (const pid of allIds) {
      const info = localPlayerMap.get(pid);
      if (info?.team && !STADIUM_COORDS[info.team]?.dome) {
        outdoorTeams.add(info.team);
      }
    }
    const weatherResults = await Promise.all(
      [...outdoorTeams].map((t) => getWeather(t, effectiveWeek)),
    );
    const weatherMap = new Map<string, WeatherInfo>();
    for (const w of weatherResults) { if (w) weatherMap.set(w.team, w); }
    const weatherArr = weatherResults.filter(Boolean) as WeatherInfo[];

    // ── Vegas / live odds ────────────────────────────────────────────────────
    const apiKey   = process.env.ODDS_API_KEY;
    let vegasLines: VegasLine[] | null = null;
    if (apiKey) {
      vegasLines = IS_DEMO
        ? await getLiveOdds(apiKey).catch(() => null)       // any currently-active sport
        : await getNflOdds(effectiveWeek).catch(() => null); // NFL only
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
     *   4. Apply a defensive-strength multiplier (0.85–1.15) based on how
     *      many points that position has historically scored against the
     *      opponent's defense in the current season.
     *   5. Apply a weather multiplier for passing/kicking positions if the
     *      game is in an outdoor stadium with high wind or precipitation.
     */
    function projectPlayer(pid: string): PlayerProjection {
      const info = localPlayerMap.get(pid);
      const name = info?.name      ?? `#${pid}`;
      const pos  = info?.position  ?? 'UNK';
      const team = info?.team      ?? null;
      const pts  = playerWeeklyPts.get(pid) ?? [];

      const mean       = pts.length > 0 ? pts.reduce((a, b) => a + b, 0) / pts.length : 0;
      const sd         = stdDev(pts);
      const rawFloor   = Math.max(0, mean - 1.28 * sd);
      const rawCeiling = mean + 1.28 * sd;

      const defMult = defAdjMultiplier(null, pos); // team's opponent unknown without weekly schedule

      let weatherMult = 1;
      let weatherNote: string | null = null;
      const wx = team ? weatherMap.get(team) : null;
      if (wx) {
        const isPassingPos = ['QB', 'WR', 'TE'].includes(pos);
        const isKicker     = pos === 'K';
        if (wx.windMph > 20 && (isPassingPos || isKicker)) {
          weatherMult *= 0.92;
          weatherNote  = `Wind ${wx.windMph}mph`;
        }
        if (wx.precipPct > 60 && isPassingPos) {
          weatherMult *= 0.95;
          weatherNote  = (weatherNote ? weatherNote + ', ' : '') + `Rain ${wx.precipPct}%`;
        }
      }

      const adj       = defMult * weatherMult;
      const floor     = parseFloat((rawFloor   * adj).toFixed(1));
      const ceiling   = parseFloat((rawCeiling * adj).toFixed(1));
      const projected = parseFloat((mean       * adj).toFixed(1));

      // In demo mode pid is a GSIS ID; remap to Sleeper numeric ID for CDN images.
      // In live mode pid is already the Sleeper ID, so the map is empty and we use pid.
      const sleeperPlayerId = gsisToSleeperIdMap.get(pid) ?? pid;
      return { playerId: pid, sleeperPlayerId, name, position: pos, team, floor, ceiling, projected, defAdjustment: adj, weatherNote };
    }

    const myProjections  = myPlayerIds.map((pid)  => projectPlayer(pid));
    const oppProjections = oppPlayerIds.map((pid) => projectPlayer(pid));

    /** Aggregates individual player projections into a team-level projection. */
    function sumTeam(projs: PlayerProjection[], name: string, rosterId: number): TeamProjection {
      return {
        name,
        rosterId,
        floor:     parseFloat(projs.reduce((s, p) => s + p.floor,     0).toFixed(1)),
        ceiling:   parseFloat(projs.reduce((s, p) => s + p.ceiling,   0).toFixed(1)),
        projected: parseFloat(projs.reduce((s, p) => s + p.projected, 0).toFixed(1)),
      };
    }

    const myTeam   = sumTeam(myProjections,  myName,  myRosterId);
    const opponent = sumTeam(oppProjections, oppName, oppRosterId);

    // ── Narrative ────────────────────────────────────────────────────────────
    const myWins   = myTeam.floor > opponent.ceiling;
    const myLikely = myTeam.projected > opponent.projected;
    const close    = Math.abs(myTeam.projected - opponent.projected) < 10;
    const wxImpact = weatherArr.some((w) => w.windMph > 20 || w.precipPct > 60);

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
      narrative += `Weather may be a factor: ${weatherArr.filter((w) => w.windMph > 20 || w.precipPct > 60).map((w) => w.note).join('; ')}.`;
    }
    if (IS_DEMO) {
      narrative += ` [Demo — ${effectiveSeason} W${effectiveWeek} stats · live ${vegasLines?.[0]?.sport ?? 'no'} odds]`;
    }

    const result: MatchupReportResponse = {
      week:    effectiveWeek,
      season:  effectiveSeason,
      myTeam,
      opponent,
      myPlayers:       myProjections,
      opponentPlayers: oppProjections,
      weather:   weatherArr.length > 0 ? weatherArr : null,
      vegasLines,
      narrative: narrative.trim(),
      ...(IS_DEMO && { demo: true }),
    };

    matchupCache.set(cacheKey, result);
    return ok(result);

  } catch (error) {
    const msg    = error instanceof Error ? error.message : 'Upstream error';
    const status = msg.includes('404') ? 404 : 502;
    return err(msg, status);
  }
}
