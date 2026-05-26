// src/lib/agentContext.ts
//
// Fetches external context (Sleeper trending, player map, league data) used by
// the agent route to build its system prompt. All requests are locally cached
// to stay well within Sleeper's rate limits.

import { prisma } from '@/lib/prisma';
import { SLEEPER_BASE } from '@/lib/sleeper/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrendingPlayer {
  player_id: string;
  count: number;
  type: 'add' | 'drop';
}

export interface SleeperRosterPlayer {
  playerId: string;
  name: string;
}

export interface LeagueRoster {
  rosterId: string;
  ownerName: string;
  players: SleeperRosterPlayer[];
}

export interface TeamStanding {
  teamName: string;
  rosterId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface UpcomingMatchup {
  week: number;
  homeTeam: string;
  awayTeam: string;
}

export interface LeagueContext {
  leagueId: string;
  sleeperLeagueId: string;
  leagueName: string;
  currentWeek: number;
  rosters: LeagueRoster[];
  standings: TeamStanding[];
  upcomingMatchups: UpcomingMatchup[];
}

// ── Internal Sleeper API shapes ───────────────────────────────────────────────

interface SleeperRosterRaw {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal: number;
  };
}

interface SleeperUserRaw {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

interface SleeperStateRaw {
  week: number;
  season_type: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const SLEEPER_MIN_INTERVAL_MS = 10 * 60 * 1000;
const TRENDING_TTL_MS         = 10 * 60 * 1000;
const PLAYER_MAP_TTL_MS       = 24 * 60 * 60 * 1000;
const ROSTER_TTL_MS           = 5 * 60 * 1000;

interface SleeperCacheEntry<T> { data: T; fetchedAt: number; }
const sleeperCache     = new Map<string, SleeperCacheEntry<unknown>>();
const sleeperLastFetch = new Map<string, number>();

async function sleeperFetch<T>(url: string, ttlMs: number): Promise<T | null> {
  const now       = Date.now();
  const cached    = sleeperCache.get(url) as SleeperCacheEntry<T> | undefined;
  const lastFetch = sleeperLastFetch.get(url) ?? 0;
  if (cached && now - cached.fetchedAt < ttlMs) return cached.data;
  if (cached && now - lastFetch < SLEEPER_MIN_INTERVAL_MS) {
    console.warn(`[sleeper] rate-limit guard: stale cache for ${url}`);
    return cached.data;
  }
  try {
    sleeperLastFetch.set(url, now);
    const res = await fetch(url, { next: { revalidate: Math.floor(ttlMs / 1000) } });
    if (!res.ok) {
      console.error(`[sleeper] HTTP ${res.status} for ${url}`);
      return cached?.data ?? null;
    }
    const data = (await res.json()) as T;
    sleeperCache.set(url, { data, fetchedAt: now });
    return data;
  } catch (err) {
    console.error(`[sleeper] fetch error for ${url}:`, err);
    return cached?.data ?? null;
  }
}

// ── Trending ──────────────────────────────────────────────────────────────────

export async function fetchTrending(): Promise<{ adds: TrendingPlayer[]; drops: TrendingPlayer[] }> {
  const [adds, drops] = await Promise.all([
    sleeperFetch<TrendingPlayer[]>(`${SLEEPER_BASE}/players/nfl/trending/add?lookback_hours=24&limit=20`, TRENDING_TTL_MS),
    sleeperFetch<TrendingPlayer[]>(`${SLEEPER_BASE}/players/nfl/trending/drop?lookback_hours=24&limit=20`, TRENDING_TTL_MS),
  ]);
  return {
    adds:  (adds  ?? []).map((p) => ({ ...p, type: 'add'  as const })),
    drops: (drops ?? []).map((p) => ({ ...p, type: 'drop' as const })),
  };
}

// ── Player map — L1 memory | L2 Turso | L3 Sleeper ───────────────────────────

const PLAYER_MAP_CACHE_KEY = 'nfl_player_map';
let playerMapMemory:   Record<string, string> | null = null;
let playerMapMemoryAt  = 0;

export async function fetchSleeperPlayerMap(): Promise<Record<string, string>> {
  const now = Date.now();
  if (playerMapMemory && now - playerMapMemoryAt < PLAYER_MAP_TTL_MS) return playerMapMemory;
  try {
    const row = await prisma.sleeperCache.findUnique({ where: { key: PLAYER_MAP_CACHE_KEY } });
    if (row) {
      const ageMs = now - row.fetchedAt.getTime();
      if (ageMs < PLAYER_MAP_TTL_MS) {
        const parsed = JSON.parse(row.data) as Record<string, string>;
        playerMapMemory  = parsed;
        playerMapMemoryAt = row.fetchedAt.getTime();
        return parsed;
      }
    }
  } catch (dbErr) { console.error('[player-map] DB read error:', dbErr); }

  type RawPlayer = { full_name?: string };
  const raw = await sleeperFetch<Record<string, RawPlayer>>(`${SLEEPER_BASE}/players/nfl`, PLAYER_MAP_TTL_MS);
  if (!raw) return playerMapMemory ?? {};

  const mapped = Object.fromEntries(
    Object.entries(raw).filter(([, p]) => p.full_name).map(([id, p]) => [id, p.full_name!]),
  );
  try {
    await prisma.sleeperCache.upsert({
      where:  { key: PLAYER_MAP_CACHE_KEY },
      update: { data: JSON.stringify(mapped), fetchedAt: new Date() },
      create: { key: PLAYER_MAP_CACHE_KEY, data: JSON.stringify(mapped) },
    });
  } catch (dbErr) { console.error('[player-map] DB write error:', dbErr); }

  playerMapMemory  = mapped;
  playerMapMemoryAt = now;
  return mapped;
}

// ── League context ────────────────────────────────────────────────────────────

/**
 * Fetches roster and user data for a Sleeper league, then derives standings
 * from each roster's win/loss/points-for record.
 *
 * Returns two parallel arrays:
 *   `rosters`   — each team's roster with player names resolved via playerMap.
 *   `standings` — the same teams sorted by wins desc, then points-for desc.
 *
 * Points-for reconstruction: Sleeper splits the value across `fpts` (integer
 * part) and `fpts_decimal` (decimal part, zero-padded to 2 digits). These are
 * combined here as `${fpts}.${fpts_decimal.padStart(2, '0')}`.
 */
async function fetchLeagueRostersAndStandings(
  sleeperLeagueId: string,
  playerMap: Record<string, string>,
): Promise<{ rosters: LeagueRoster[]; standings: TeamStanding[] }> {
  const [rosters, users] = await Promise.all([
    sleeperFetch<SleeperRosterRaw[]>(`${SLEEPER_BASE}/league/${sleeperLeagueId}/rosters`, ROSTER_TTL_MS),
    sleeperFetch<SleeperUserRaw[]>(`${SLEEPER_BASE}/league/${sleeperLeagueId}/users`,   ROSTER_TTL_MS),
  ]);
  if (!rosters) return { rosters: [], standings: [] };

  const userMap = new Map((users ?? []).map((u) => [u.user_id, u]));
  const leagueRosters: LeagueRoster[] = [];
  const standings: TeamStanding[] = [];

  for (const r of rosters) {
    const user      = r.owner_id ? userMap.get(r.owner_id) : undefined;
    const ownerName = user?.metadata?.team_name ?? user?.display_name ?? `Team ${r.roster_id}`;
    const players: SleeperRosterPlayer[] = (r.players ?? []).map((id) => ({
      playerId: id,
      name: playerMap[id] ?? id,
    }));
    leagueRosters.push({ rosterId: String(r.roster_id), ownerName, players });

    const wins       = r.settings?.wins ?? 0;
    const losses     = r.settings?.losses ?? 0;
    const ties       = r.settings?.ties ?? 0;
    const pointsFor  = parseFloat(
      `${r.settings?.fpts ?? 0}.${String(r.settings?.fpts_decimal ?? 0).padStart(2, '0')}`,
    );
    standings.push({ teamName: ownerName, rosterId: String(r.roster_id), wins, losses, ties, pointsFor });
  }

  standings.sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);
  return { rosters: leagueRosters, standings };
}

/**
 * Fetches the NFL regular-season schedule for the current week and the next
 * two weeks, returning the first 5 games per week.
 *
 * Used to populate the "UPCOMING NFL MATCHUPS" block in the AI system prompt
 * so the model can reason about playoff-schedule strength.
 *
 * Weeks beyond 18 (the end of the regular season) are omitted automatically.
 */
async function fetchUpcomingSchedule(
  currentWeek: number,
  currentSeason: number,
): Promise<UpcomingMatchup[]> {
  const weeksToFetch = [currentWeek, currentWeek + 1, currentWeek + 2].filter((w) => w <= 18);
  const schedules = await Promise.all(
    weeksToFetch.map((w) =>
      sleeperFetch<{ home_team: string; away_team: string }[]>(
        `${SLEEPER_BASE}/schedule/nfl/regular/${currentSeason}/${w}`,
        TRENDING_TTL_MS,
      ),
    ),
  );
  return schedules.flatMap((games, i) =>
    (games ?? []).slice(0, 5).map((g) => ({
      week:     weeksToFetch[i],
      homeTeam: g.home_team,
      awayTeam: g.away_team,
    })),
  );
}

/**
 * Assembles a complete LeagueContext object for the given Sleeper league.
 *
 * Fetches in parallel:
 *   • League name (from local DB)
 *   • Current NFL week (from Sleeper state API)
 *   • Rosters + standings (from Sleeper roster/user APIs)
 *   • Upcoming NFL schedule (from Sleeper schedule API, next 2–3 weeks)
 *
 * The context is injected into the AI system prompt for league-aware intents
 * (standings, roster_scan, playoff_schedule, etc.).
 *
 * @param sleeperLeagueId  Sleeper league ID (numeric string).
 * @param playerMap        player_id → full name mapping for roster enrichment.
 * @param currentSeason    Current NFL season year (e.g. 2025).
 * @returns  Populated LeagueContext, or null if an unrecoverable error occurs.
 */
export async function fetchLeagueContext(
  sleeperLeagueId: string,
  playerMap: Record<string, string>,
  currentSeason: number,
): Promise<LeagueContext | null> {
  try {
    const league = await prisma.league.findFirst({
      where:  { sleeperLeagueId },
      select: { id: true, sleeperLeagueId: true, name: true },
    });
    const leagueName = league?.name ?? `League ${sleeperLeagueId}`;

    const nflState = await sleeperFetch<SleeperStateRaw>(
      `${SLEEPER_BASE}/state/nfl`,
      TRENDING_TTL_MS,
    );
    const currentWeek = nflState?.week ?? 1;

    const [{ rosters, standings }, upcomingMatchups] = await Promise.all([
      fetchLeagueRostersAndStandings(sleeperLeagueId, playerMap),
      fetchUpcomingSchedule(currentWeek, currentSeason),
    ]);

    return {
      leagueId: league?.id ?? sleeperLeagueId,
      sleeperLeagueId,
      leagueName,
      currentWeek,
      rosters,
      standings,
      upcomingMatchups,
    };
  } catch (err) {
    console.error('[league-context] error:', err);
    return null;
  }
}
