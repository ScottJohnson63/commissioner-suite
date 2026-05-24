// src/app/api/agent/route.ts

import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '@/lib/prisma';

// ── Clients ───────────────────────────────────────────────────────────────────

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// NFL_SEASON must be set to the most recently completed season (e.g. 2025).
// "Last year" queries resolve to PREV_SEASON. Missing or stale env var is the
// most common cause of wrong season data — verify in .env.local and production.
const CURRENT_SEASON = parseInt(process.env.NFL_SEASON ?? String(new Date().getFullYear()), 10);
const PREV_SEASON = CURRENT_SEASON - 1;

// ── Rate limiting ─────────────────────────────────────────────────────────────

interface HourBucket { count: number; windowStart: number; }
interface DayBucket  { count: number; dayKey: string; }

const hourlyBuckets = new Map<string, HourBucket>();
let dailyBucket: DayBucket = { count: 0, dayKey: '' };
const HOURLY_LIMIT = 15;

function todayKey(): string { return new Date().toISOString().slice(0, 10); }

function getDailyCount(): number {
    const key = todayKey();
    if (dailyBucket.dayKey !== key) dailyBucket = { count: 0, dayKey: key };
    return dailyBucket.count;
}

function incrementDaily(): void {
    const key = todayKey();
    if (dailyBucket.dayKey !== key) dailyBucket = { count: 0, dayKey: key };
    dailyBucket.count += 1;
}

function checkHourlyLimit(clientId: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    let bucket = hourlyBuckets.get(clientId);
    if (!bucket || now - bucket.windowStart >= ONE_HOUR_MS) {
        bucket = { count: 0, windowStart: now };
        hourlyBuckets.set(clientId, bucket);
    }
    const remaining = Math.max(0, HOURLY_LIMIT - bucket.count);
    const resetAt = bucket.windowStart + ONE_HOUR_MS;
    if (bucket.count >= HOURLY_LIMIT) return { allowed: false, remaining: 0, resetAt };
    bucket.count += 1;
    hourlyBuckets.set(clientId, bucket);
    return { allowed: true, remaining: remaining - 1, resetAt };
}

function getClientId(req: NextRequest): string {
    return (
        req.headers.get('x-client-id')?.trim() ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown'
    );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlayerStats {
    playerId: string;
    playerName?: string | null;
    playerDisplayName?: string | null;
    position?: string | null;
    team?: string | null;
    opponentTeam?: string | null;
    week?: number | null;
    season?: number | null;
    // Passing
    passingYards?: number | null;
    passingTds?: number | null;
    passingInterceptions?: number | null;
    passingEpa?: number | null;
    // Rushing
    carries?: number | null;
    rushingYards?: number | null;
    rushingTds?: number | null;
    rushingEpa?: number | null;
    // Receiving — Phase 1: full receiving suite
    receptions?: number | null;
    targets?: number | null;
    receivingYards?: number | null;
    receivingTds?: number | null;
    receivingEpa?: number | null;
    receivingAirYards?: number | null;       // Phase 1
    receivingYardsAfterCatch?: number | null; // Phase 1
    airYardsShare?: number | null;            // Phase 1
    racr?: number | null;                     // Phase 1 (receiver air conversion ratio)
    targetShare?: number | null;
    wopr?: number | null;
    fantasyPointsPpr?: number | null;
}

interface TrendingPlayer {
    player_id: string;
    count: number;
    type: 'add' | 'drop';
}

type ModelUsed = 'gemini' | 'groq';

// ── Phase 2: League context types ─────────────────────────────────────────────

interface SleeperRosterPlayer {
    playerId: string;
    name: string;
}

interface LeagueRoster {
    rosterId: string;
    ownerName: string;
    players: SleeperRosterPlayer[];
}

interface LeagueContext {
    leagueId: string;           // internal Turso league ID
    sleeperLeagueId: string;    // Sleeper league ID
    leagueName: string;
    currentWeek: number;
    rosters: LeagueRoster[];
    standings: TeamStanding[];
    upcomingMatchups: UpcomingMatchup[];
}

interface TeamStanding {
    teamName: string;
    rosterId: string;
    wins: number;
    losses: number;
    ties: number;
    pointsFor: number;
}

interface UpcomingMatchup {
    week: number;
    homeTeam: string;
    awayTeam: string;
}

// ── Query plan types ──────────────────────────────────────────────────────────

type QueryIntent =
    | 'top_position'        // "best QBs last year"
    | 'player_vs_opponent'  // "Josh Allen vs the Patriots"
    | 'player_comparison'   // "Lamar vs Mahomes"
    | 'player_recent'       // "how has Davante Adams been doing"
    | 'air_yards_efficiency' // Phase 1: "WRs with high air yards but few catches"
    | 'workload_trend'       // Phase 1: "is RB X declining over the season"
    | 'efficiency_gap'       // Phase 1: "high targets, low points — buy-low"
    | 'standings'            // Phase 2: "who is in first place / league standings"
    | 'roster_scan'          // Phase 2: "who in our league has weak RBs"
    | 'playoff_schedule'     // Phase 2: "who has easiest playoff schedule"
    | 'trending'             // "who to pick up off waivers"
    | 'general';             // fallback

interface QueryPlan {
    intent: QueryIntent;
    players: string[];
    position: string | null;
    opponent: string | null;
    season: number | null;
    weeksBack: number | null;   // Phase 1: "last 3 weeks" → 3
}

// ── Sleeper cache ─────────────────────────────────────────────────────────────

const SLEEPER_MIN_INTERVAL_MS = 10 * 60 * 1000;
const TRENDING_TTL_MS  = 10 * 60 * 1000;
const PLAYER_MAP_TTL_MS = 24 * 60 * 60 * 1000;
const ROSTER_TTL_MS    = 5 * 60 * 1000;  // Phase 2: rosters refresh every 5 min

interface SleeperCacheEntry<T> { data: T; fetchedAt: number; }

const sleeperCache = new Map<string, SleeperCacheEntry<unknown>>();
const sleeperLastFetch = new Map<string, number>();

async function sleeperFetch<T>(url: string, ttlMs: number): Promise<T | null> {
    const now = Date.now();
    const cached = sleeperCache.get(url) as SleeperCacheEntry<T> | undefined;
    const lastFetch = sleeperLastFetch.get(url) ?? 0;
    if (cached && now - cached.fetchedAt < ttlMs) return cached.data;
    if (cached && now - lastFetch < SLEEPER_MIN_INTERVAL_MS) {
        console.warn(`[sleeper] rate-limit guard: stale cache for ${url}`);
        return cached.data;
    }
    try {
        sleeperLastFetch.set(url, now);
        const res = await fetch(url, { next: { revalidate: Math.floor(ttlMs / 1000) } });
        if (!res.ok) { console.error(`[sleeper] HTTP ${res.status} for ${url}`); return cached?.data ?? null; }
        const data = (await res.json()) as T;
        sleeperCache.set(url, { data, fetchedAt: now });
        return data;
    } catch (err) {
        console.error(`[sleeper] fetch error for ${url}:`, err);
        return cached?.data ?? null;
    }
}

async function fetchTrending(): Promise<{ adds: TrendingPlayer[]; drops: TrendingPlayer[] }> {
    const [adds, drops] = await Promise.all([
        sleeperFetch<TrendingPlayer[]>(`${SLEEPER_BASE}/players/nfl/trending/add?lookback_hours=24&limit=20`, TRENDING_TTL_MS),
        sleeperFetch<TrendingPlayer[]>(`${SLEEPER_BASE}/players/nfl/trending/drop?lookback_hours=24&limit=20`, TRENDING_TTL_MS),
    ]);
    return {
        adds: (adds ?? []).map((p) => ({ ...p, type: 'add' as const })),
        drops: (drops ?? []).map((p) => ({ ...p, type: 'drop' as const })),
    };
}

// ── Player map — L1 memory | L2 Turso | L3 Sleeper ───────────────────────────

const PLAYER_MAP_CACHE_KEY = 'nfl_player_map';
let playerMapMemory: Record<string, string> | null = null;
let playerMapMemoryAt = 0;

async function fetchSleeperPlayerMap(): Promise<Record<string, string>> {
    const now = Date.now();
    if (playerMapMemory && now - playerMapMemoryAt < PLAYER_MAP_TTL_MS) return playerMapMemory;
    try {
        const row = await prisma.sleeperCache.findUnique({ where: { key: PLAYER_MAP_CACHE_KEY } });
        if (row) {
            const ageMs = now - row.fetchedAt.getTime();
            if (ageMs < PLAYER_MAP_TTL_MS) {
                const parsed = JSON.parse(row.data) as Record<string, string>;
                playerMapMemory = parsed;
                playerMapMemoryAt = row.fetchedAt.getTime();
                return parsed;
            }
        }
    } catch (dbErr) { console.error('[player-map] DB read error:', dbErr); }

    type RawPlayer = { full_name?: string };
    const raw = await sleeperFetch<Record<string, RawPlayer>>('https://api.sleeper.app/v1/players/nfl', PLAYER_MAP_TTL_MS);
    if (!raw) return playerMapMemory ?? {};

    const mapped = Object.fromEntries(
        Object.entries(raw).filter(([, p]) => p.full_name).map(([id, p]) => [id, p.full_name!]),
    );
    try {
        await prisma.sleeperCache.upsert({
            where: { key: PLAYER_MAP_CACHE_KEY },
            update: { data: JSON.stringify(mapped), fetchedAt: new Date() },
            create: { key: PLAYER_MAP_CACHE_KEY, data: JSON.stringify(mapped) },
        });
    } catch (dbErr) { console.error('[player-map] DB write error:', dbErr); }

    playerMapMemory = mapped;
    playerMapMemoryAt = now;
    return mapped;
}

// ── Phase 2: League context fetchers ─────────────────────────────────────────

interface SleeperRosterRaw {
    roster_id: number;
    owner_id: string | null;
    players: string[] | null;  // array of Sleeper player IDs
    settings: {
        wins: number;
        losses: number;
        ties: number;
        fpts: number;        // fantasy points for (integer part)
        fpts_decimal: number; // fantasy points for (decimal part)
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

/**
 * Fetches Sleeper roster + user data for a league.
 * Returns both the roster list (with resolved player names) and standings.
 * Standings come directly from roster.settings which Sleeper keeps as
 * running totals — no need to fetch week-by-week matchup history.
 * Both are derived from a single /rosters call, cached for ROSTER_TTL_MS.
 */
async function fetchLeagueRostersAndStandings(
    sleeperLeagueId: string,
    playerMap: Record<string, string>,
): Promise<{ rosters: LeagueRoster[]; standings: TeamStanding[] }> {
    const [rosters, users] = await Promise.all([
        sleeperFetch<SleeperRosterRaw[]>(`${SLEEPER_BASE}/league/${sleeperLeagueId}/rosters`, ROSTER_TTL_MS),
        sleeperFetch<SleeperUserRaw[]>(`${SLEEPER_BASE}/league/${sleeperLeagueId}/users`, ROSTER_TTL_MS),
    ]);

    if (!rosters) return { rosters: [], standings: [] };

    const userMap = new Map((users ?? []).map((u) => [u.user_id, u]));

    const leagueRosters: LeagueRoster[] = [];
    const standings: TeamStanding[] = [];

    for (const r of rosters) {
        const user = r.owner_id ? userMap.get(r.owner_id) : undefined;
        const ownerName = user?.metadata?.team_name ?? user?.display_name ?? `Team ${r.roster_id}`;

        // Resolve player IDs to names via player map
        const players: SleeperRosterPlayer[] = (r.players ?? []).map((id) => ({
            playerId: id,
            name: playerMap[id] ?? id,
        }));

        leagueRosters.push({ rosterId: String(r.roster_id), ownerName, players });

        // Sleeper stores running W/L/PF totals on the roster settings object.
        // fpts is stored as integer + decimal separately (e.g. 142 + 0.60 = 142.60)
        const wins = r.settings?.wins ?? 0;
        const losses = r.settings?.losses ?? 0;
        const ties = r.settings?.ties ?? 0;
        const pointsFor = parseFloat(
            `${r.settings?.fpts ?? 0}.${String(r.settings?.fpts_decimal ?? 0).padStart(2, '0')}`,
        );

        standings.push({ teamName: ownerName, rosterId: String(r.roster_id), wins, losses, ties, pointsFor });
    }

    // Sort standings: wins desc, then points for desc
    standings.sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);

    return { rosters: leagueRosters, standings };
}

/**
 * Fetches the upcoming NFL schedule from Sleeper for context on future matchups.
 */
async function fetchUpcomingSchedule(currentWeek: number): Promise<UpcomingMatchup[]> {
    const weeksToFetch = [currentWeek, currentWeek + 1, currentWeek + 2].filter((w) => w <= 18);
    const schedules = await Promise.all(
        weeksToFetch.map((w) =>
            sleeperFetch<{ home_team: string; away_team: string }[]>(
                `${SLEEPER_BASE}/schedule/nfl/regular/${CURRENT_SEASON}/${w}`,
                TRENDING_TTL_MS,
            ),
        ),
    );

    return schedules.flatMap((games, i) =>
        (games ?? []).slice(0, 5).map((g) => ({
            week: weeksToFetch[i],
            homeTeam: g.home_team,
            awayTeam: g.away_team,
        })),
    );
}

/**
 * Assembles full league context. Gracefully returns null if the league
 * doesn't exist in Turso or Sleeper calls fail — the agent works without it.
 */
async function fetchLeagueContext(
    sleeperLeagueId: string,
    playerMap: Record<string, string>,
): Promise<LeagueContext | null> {
    try {
        const league = await prisma.league.findFirst({
            where: { sleeperLeagueId },
            select: { id: true, sleeperLeagueId: true, name: true },
        });
        const leagueName = league?.name ?? `League ${sleeperLeagueId}`;

        // Get current NFL week from Sleeper state API
        const nflState = await sleeperFetch<SleeperStateRaw>(
            `${SLEEPER_BASE}/state/nfl`,
            TRENDING_TTL_MS,
        );
        const currentWeek = nflState?.week ?? 1;

        const [{ rosters, standings }, upcomingMatchups] = await Promise.all([
            fetchLeagueRostersAndStandings(sleeperLeagueId, playerMap),
            fetchUpcomingSchedule(currentWeek),
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

// ── Turso stat queries ────────────────────────────────────────────────────────

// Phase 1: expanded STAT_SELECT — all receiving fields now included
const STAT_SELECT = {
    playerId: true,
    playerName: true,
    playerDisplayName: true,
    position: true,
    team: true,
    opponentTeam: true,
    week: true,
    season: true,
    carries: true,
    passingYards: true,
    passingTds: true,
    passingInterceptions: true,
    passingEpa: true,
    rushingYards: true,
    rushingTds: true,
    rushingEpa: true,
    receptions: true,
    targets: true,
    receivingYards: true,
    receivingTds: true,
    receivingEpa: true,
    receivingAirYards: true,           // Phase 1
    receivingYardsAfterCatch: true,    // Phase 1
    airYardsShare: true,               // Phase 1
    racr: true,                        // Phase 1
    targetShare: true,
    wopr: true,
    fantasyPointsPpr: true,
} as const;

async function resolvePlayerId(name: string): Promise<string | null> {
    try {
        const row = await prisma.nflWeeklyStat.findFirst({
            where: { playerDisplayName: { contains: name }, season: { gte: PREV_SEASON } },
            select: { playerId: true },
            orderBy: { season: 'desc' },
        });
        return row?.playerId ?? null;
    } catch { return null; }
}

async function executeQueryPlan(plan: QueryPlan): Promise<PlayerStats[]> {
    const season = plan.season ?? CURRENT_SEASON;
    const prevSeason = season - 1;

    try {
        switch (plan.intent) {

            // "Who were the best QBs last season?"
            case 'top_position': {
                const targetSeason = plan.season ?? prevSeason;
                const pos = plan.position ?? 'QB';
                const rows = await prisma.nflWeeklyStat.findMany({
                    where: { season: targetSeason, week: { gte: 1, lte: 18 }, position: pos, fantasyPointsPpr: { gt: 0 } },
                    orderBy: [{ playerId: 'asc' }, { week: 'asc' }],
                    select: STAT_SELECT,
                });

                interface PlayerAggregate extends PlayerStats {
                    totalPts: number; gamesPlayed: number; ptsPerGame: number;
                }
                const byPlayer = new Map<string, PlayerAggregate>();

                for (const r of rows) {
                    const existing = byPlayer.get(r.playerId);
                    if (existing) {
                        existing.totalPts += r.fantasyPointsPpr ?? 0;
                        existing.gamesPlayed += 1;
                        existing.passingYards = (existing.passingYards ?? 0) + (r.passingYards ?? 0);
                        existing.passingTds = (existing.passingTds ?? 0) + (r.passingTds ?? 0);
                        existing.passingInterceptions = (existing.passingInterceptions ?? 0) + (r.passingInterceptions ?? 0);
                        existing.carries = (existing.carries ?? 0) + (r.carries ?? 0);
                        existing.rushingYards = (existing.rushingYards ?? 0) + (r.rushingYards ?? 0);
                        existing.rushingTds = (existing.rushingTds ?? 0) + (r.rushingTds ?? 0);
                        existing.receptions = (existing.receptions ?? 0) + (r.receptions ?? 0);
                        existing.targets = (existing.targets ?? 0) + (r.targets ?? 0);
                        existing.receivingYards = (existing.receivingYards ?? 0) + (r.receivingYards ?? 0);
                        existing.receivingTds = (existing.receivingTds ?? 0) + (r.receivingTds ?? 0);
                        existing.receivingAirYards = (existing.receivingAirYards ?? 0) + (r.receivingAirYards ?? 0);
                        existing.receivingYardsAfterCatch = (existing.receivingYardsAfterCatch ?? 0) + (r.receivingYardsAfterCatch ?? 0);
                    } else {
                        byPlayer.set(r.playerId, { ...r, totalPts: r.fantasyPointsPpr ?? 0, gamesPlayed: 1, ptsPerGame: 0 });
                    }
                }

                const MIN_GAMES = 6;
                const qualified = [...byPlayer.values()]
                    .filter((p) => p.gamesPlayed >= MIN_GAMES)
                    .map((p) => ({ ...p, ptsPerGame: parseFloat((p.totalPts / p.gamesPlayed).toFixed(1)) }));

                return qualified
                    .sort((a, b) =>
                        b.totalPts !== a.totalPts
                            ? b.totalPts - a.totalPts
                            : (a.playerDisplayName ?? '').localeCompare(b.playerDisplayName ?? ''),
                    )
                    .slice(0, 10)
                    .map(({ totalPts, gamesPlayed, ptsPerGame, ...rest }) => ({
                        ...rest,
                        fantasyPointsPpr: parseFloat(totalPts.toFixed(1)),
                        playerDisplayName: `${rest.playerDisplayName ?? rest.playerName} (${gamesPlayed}G, ${ptsPerGame}/g avg)`,
                    }));
            }

            // "How has Josh Allen played against the Patriots?"
            case 'player_vs_opponent': {
                if (!plan.players.length || !plan.opponent) return fallbackRecentStats();
                const playerId = await resolvePlayerId(plan.players[0]);
                if (!playerId) return fallbackRecentStats();
                return prisma.nflWeeklyStat.findMany({
                    where: { playerId, opponentTeam: { contains: plan.opponent }, week: { gte: 1, lte: 18 } },
                    orderBy: [{ season: 'desc' }, { week: 'desc' }],
                    select: STAT_SELECT,
                }) as unknown as PlayerStats[];
            }

            // "Should I start Lamar or Mahomes?"
            case 'player_comparison': {
                if (plan.players.length < 2) return fallbackRecentStats();
                const ids = await Promise.all(plan.players.map(resolvePlayerId));
                const validIds = ids.filter((id): id is string => id !== null);
                if (!validIds.length) return fallbackRecentStats();
                return prisma.nflWeeklyStat.findMany({
                    where: { playerId: { in: validIds }, season: { gte: prevSeason }, week: { gte: 1, lte: 18 } },
                    orderBy: [{ season: 'desc' }, { week: 'desc' }],
                    take: 32,
                    select: STAT_SELECT,
                }) as unknown as PlayerStats[];
            }

            // "How has Davante Adams been doing?"
            case 'player_recent': {
                if (!plan.players.length) return fallbackRecentStats();
                const playerId = await resolvePlayerId(plan.players[0]);
                if (!playerId) return fallbackRecentStats();
                return prisma.nflWeeklyStat.findMany({
                    where: { playerId, week: { gte: 1, lte: 18 } },
                    orderBy: [{ season: 'desc' }, { week: 'desc' }],
                    take: 10,
                    select: STAT_SELECT,
                }) as unknown as PlayerStats[];
            }

            // Phase 1: "Find WRs with high air yards but few receptions"
            case 'air_yards_efficiency': {
                const weeks = plan.weeksBack ?? 2;
                const pos = plan.position ?? 'WR';

                // Find the most recent week for reference
                const latest = await prisma.nflWeeklyStat.findFirst({
                    where: { season: CURRENT_SEASON, week: { gte: 1, lte: 18 } },
                    orderBy: { week: 'desc' },
                    select: { week: true },
                });
                const maxWeek = latest?.week ?? 18;
                const minWeek = Math.max(1, maxWeek - weeks + 1);

                return prisma.nflWeeklyStat.findMany({
                    where: {
                        season: CURRENT_SEASON,
                        week: { gte: minWeek, lte: maxWeek },
                        position: pos,
                        receivingAirYards: { gt: 0 },
                    },
                    orderBy: { receivingAirYards: 'desc' },
                    take: 30,
                    select: STAT_SELECT,
                }) as unknown as PlayerStats[];
            }

            // Phase 1: "Is RB X declining as the season goes on?"
            case 'workload_trend': {
                if (!plan.players.length) return fallbackRecentStats();
                const playerId = await resolvePlayerId(plan.players[0]);
                if (!playerId) return fallbackRecentStats();
                // Pull entire current season in week order so trend is visible
                return prisma.nflWeeklyStat.findMany({
                    where: { playerId, season: CURRENT_SEASON, week: { gte: 1, lte: 18 } },
                    orderBy: { week: 'asc' },
                    select: STAT_SELECT,
                }) as unknown as PlayerStats[];
            }

            // Phase 1: "High targets, low points — buy-low candidates"
            case 'efficiency_gap': {
                const pos = plan.position ?? 'WR';
                const rows = await prisma.nflWeeklyStat.findMany({
                    where: {
                        season: CURRENT_SEASON,
                        week: { gte: 1, lte: 18 },
                        position: pos,
                        targets: { gt: 0 },
                        fantasyPointsPpr: { gt: 0 },
                    },
                    orderBy: [{ playerId: 'asc' }, { week: 'asc' }],
                    select: STAT_SELECT,
                });

                // Aggregate season totals per player
                const byPlayer = new Map<string, PlayerStats & { totalTargets: number; totalPts: number; games: number }>();
                for (const r of rows) {
                    const ex = byPlayer.get(r.playerId);
                    if (ex) {
                        ex.totalTargets += r.targets ?? 0;
                        ex.totalPts += r.fantasyPointsPpr ?? 0;
                        ex.games += 1;
                        ex.receivingAirYards = (ex.receivingAirYards ?? 0) + (r.receivingAirYards ?? 0);
                        ex.receptions = (ex.receptions ?? 0) + (r.receptions ?? 0);
                        ex.receivingYards = (ex.receivingYards ?? 0) + (r.receivingYards ?? 0);
                        ex.receivingYardsAfterCatch = (ex.receivingYardsAfterCatch ?? 0) + (r.receivingYardsAfterCatch ?? 0);
                    } else {
                        byPlayer.set(r.playerId, { ...r, totalTargets: r.targets ?? 0, totalPts: r.fantasyPointsPpr ?? 0, games: 1 });
                    }
                }

                // Sort by targets desc, then by pts/target asc (most "unlucky" first)
                return [...byPlayer.values()]
                    .filter((p) => p.games >= 4)
                    .sort((a, b) => {
                        const effA = a.totalPts / Math.max(a.totalTargets, 1);
                        const effB = b.totalPts / Math.max(b.totalTargets, 1);
                        // High targets + low efficiency = best buy-low
                        if (b.totalTargets !== a.totalTargets) return b.totalTargets - a.totalTargets;
                        return effA - effB;
                    })
                    .slice(0, 15)
                    .map(({ totalTargets, totalPts, games, ...rest }) => ({
                        ...rest,
                        targets: totalTargets,
                        fantasyPointsPpr: parseFloat(totalPts.toFixed(1)),
                        playerDisplayName: `${rest.playerDisplayName ?? rest.playerName} (${games}G)`,
                    }));
            }

            // Phase 2: standings/roster/playoff — data comes from league context injected
            // into the system prompt. DB stats are not needed for these intents.
            case 'standings':
            case 'roster_scan':
            case 'playoff_schedule':
                return fallbackRecentStats();

            case 'trending':
            case 'general':
            default:
                return fallbackRecentStats();
        }
    } catch (err) {
        console.error('[query-plan] execution error:', err);
        return fallbackRecentStats();
    }
}

async function fallbackRecentStats(): Promise<PlayerStats[]> {
    try {
        const latest = await prisma.nflWeeklyStat.findFirst({
            where: { season: CURRENT_SEASON, week: { gte: 1, lte: 18 } },
            orderBy: [{ season: 'desc' }, { week: 'desc' }],
            select: { week: true, season: true },
        });
        const targetSeason = latest?.season ?? PREV_SEASON;
        const targetWeek = latest?.week ?? 18;
        return prisma.nflWeeklyStat.findMany({
            where: { season: targetSeason, week: targetWeek, fantasyPointsPpr: { gt: 0 } },
            orderBy: { fantasyPointsPpr: 'desc' },
            take: 25,
            select: STAT_SELECT,
        }) as unknown as PlayerStats[];
    } catch { return []; }
}

// ── Pass 1 — intent classification ───────────────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `You are a query planner for a fantasy football AI assistant.
Analyze the user's question and output ONLY a JSON object — no explanation, no markdown, no backticks.

Output schema:
{
  "intent": one of: "top_position" | "player_vs_opponent" | "player_comparison" | "player_recent" | "air_yards_efficiency" | "workload_trend" | "efficiency_gap" | "standings" | "roster_scan" | "playoff_schedule" | "trending" | "general",
  "players": array of player display names mentioned (e.g. ["Josh Allen", "Patrick Mahomes"]),
  "position": position group if relevant ("QB" | "RB" | "WR" | "TE") or null,
  "opponent": opponent team abbreviation if mentioned (e.g. "NE", "KC", "DAL") or null,
  "season": explicit season year as integer if mentioned (e.g. 2023) or null,
  "weeksBack": number of recent weeks if mentioned (e.g. "last 3 weeks" → 3) or null
}

Intent rules:
- top_position: best/top players at a position, rankings, season leaders
- player_vs_opponent: how a specific player performs against a specific team
- player_comparison: compare or choose between 2+ named players (start/sit, trade value)
- player_recent: single named player's recent form or stats
- air_yards_efficiency: air yards vs receptions analysis, deep threat bounce-back candidates
- workload_trend: single player's touch/carry count over the season (declining workload, sell signal)
- efficiency_gap: high targets but low points, buy-low candidates, underperforming their opportunity
- standings: ANY question about league standings, rankings, records, or who is winning/losing YOUR league. Examples: "who is in first place", "who has the best record", "league standings", "who is last place", "who is leading our league", "who has the most points in our league"
- roster_scan: scanning league rosters for trade targets, weak positions, manager analysis
- playoff_schedule: playoff weeks 15-17 matchup analysis, strength of schedule
- trending: waiver wire, who to pick up or drop
- general: anything else — only use this if no other intent fits

IMPORTANT: If the question mentions "our league", "my league", "the league", "first place", "last place", or "standings", always use standings, roster_scan, or playoff_schedule — never general.`;

async function classifyIntent(userMessage: string): Promise<QueryPlan> {
    const fallback: QueryPlan = { intent: 'general', players: [], position: null, opponent: null, season: null, weeksBack: null };
    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: PLANNER_SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
            stream: false,
            temperature: 0,
            max_tokens: 150,
        });
        const raw = response.choices[0]?.message?.content ?? '';
        console.log('[pass-1] raw planner output:', raw);
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean) as QueryPlan;
        const validIntents: QueryIntent[] = [
            'top_position', 'player_vs_opponent', 'player_comparison', 'player_recent',
            'air_yards_efficiency', 'workload_trend', 'efficiency_gap',
            'standings', 'roster_scan', 'playoff_schedule', 'trending', 'general',
        ];
        if (!validIntents.includes(parsed.intent)) return fallback;
        return {
            intent: parsed.intent,
            players: Array.isArray(parsed.players) ? parsed.players : [],
            position: parsed.position ?? null,
            opponent: parsed.opponent ?? null,
            season: typeof parsed.season === 'number' ? parsed.season : null,
            weeksBack: typeof parsed.weeksBack === 'number' ? parsed.weeksBack : null,
        };
    } catch (err) {
        console.error('[pass-1] intent classification error:', err);
        return fallback;
    }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function formatStatRow(p: PlayerStats): string {
    const parts = [
        `${p.playerDisplayName ?? p.playerName ?? p.playerId}`,
        p.position    ? `(${p.position})`        : '',
        p.team        ? `${p.team}`               : '',
        p.opponentTeam ? `vs ${p.opponentTeam}`  : '',
        p.season && p.week ? `Wk${p.week} ${p.season}` : p.season ? String(p.season) : '',
    ].filter(Boolean);

    // Derive aDOT (average depth of target) if both fields available — Phase 1
    const aDot = (p.receivingAirYards != null && p.targets && p.targets > 0)
        ? (p.receivingAirYards / p.targets).toFixed(1)
        : null;

    const stats = [
        p.fantasyPointsPpr != null ? `${p.fantasyPointsPpr.toFixed(1)}pts` : '',
        p.passingYards     ? `${p.passingYards}PassYds`    : '',
        p.passingTds       ? `${p.passingTds}PassTD`       : '',
        p.passingInterceptions ? `${p.passingInterceptions}INT` : '',
        p.passingEpa != null ? `PassEPA ${p.passingEpa.toFixed(1)}` : '',
        p.carries          ? `${p.carries}Car`             : '',
        p.rushingYards     ? `${p.rushingYards}RushYds`    : '',
        p.rushingTds       ? `${p.rushingTds}RushTD`       : '',
        p.receptions != null ? `${p.receptions}/${p.targets ?? '?'}Rec` : '',
        p.receivingYards   ? `${p.receivingYards}RecYds`   : '',
        p.receivingTds     ? `${p.receivingTds}RecTD`      : '',
        p.targetShare != null ? `${(p.targetShare * 100).toFixed(0)}%TgtShr` : '',
        // Phase 1 fields
        p.receivingAirYards != null ? `${p.receivingAirYards}AirYds` : '',
        aDot               ? `aDOT ${aDot}`                : '',
        p.receivingYardsAfterCatch != null ? `${p.receivingYardsAfterCatch}YAC` : '',
        p.airYardsShare != null ? `${(p.airYardsShare * 100).toFixed(0)}%AirShr` : '',
        p.racr != null     ? `RACR ${p.racr.toFixed(2)}`  : '',
        p.wopr != null     ? `WOPR ${p.wopr.toFixed(2)}`  : '',
    ].filter(Boolean);

    return `${parts.join(' ')} | ${stats.join(', ')}`;
}

// Phase 2: format league context into a readable block for the system prompt
function formatLeagueContext(ctx: LeagueContext): string {
    const standingsBlock = ctx.standings
        .map((s, i) => {
            const record = s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
            return `  ${i + 1}. ${s.teamName} (${record}, ${s.pointsFor.toFixed(2)} PF)`;
        })
        .join('\n');

    const rosterBlock = ctx.rosters
        .map((r) => {
            const playerList = r.players.map((p) => p.name).join(', ');
            return `  ${r.ownerName}: ${playerList || 'no players'}`;
        })
        .join('\n');

    const upcomingBlock = ctx.upcomingMatchups
        .map((m) => `  Wk${m.week}: ${m.homeTeam} vs ${m.awayTeam}`)
        .join('\n');

    return `--- LEAGUE CONTEXT: ${ctx.leagueName} (Week ${ctx.currentWeek}) ---
STANDINGS:
${standingsBlock || '  No standings data.'}

ROSTERS:
${rosterBlock || '  No roster data.'}

UPCOMING NFL MATCHUPS (next 2-3 weeks):
${upcomingBlock || '  No schedule data.'}
`;
}

function buildSystemPrompt(
    stats: PlayerStats[],
    trendingAdds: TrendingPlayer[],
    trendingDrops: TrendingPlayer[],
    playerMap: Record<string, string>,
    plan: QueryPlan,
    dataContext: string,
    leagueCtx: LeagueContext | null,
    missingLeague = false,
): string {
    const statsBlock = stats.length
        ? stats.map((p, i) => `${i + 1}. ${formatStatRow(p)}`).join('\n')
        : 'No stat data available for this query.';

    const addsBlock = trendingAdds.slice(0, 10)
        .map((p) => `${playerMap[p.player_id] ?? p.player_id} (added ${p.count}x)`).join(', ') || 'No trending data.';

    const dropsBlock = trendingDrops.slice(0, 10)
        .map((p) => `${playerMap[p.player_id] ?? p.player_id} (dropped ${p.count}x)`).join(', ') || 'No trending data.';

    const leagueBlock = leagueCtx ? formatLeagueContext(leagueCtx) : '';

    return `You are an expert fantasy football analyst. Answer using ONLY the data provided below.
Be direct. Lead with your recommendation, then support it with the stats.
If the data is insufficient, say so clearly rather than guessing.
Do not reference players or stats not present in the data.
The NFL STATS section is pre-ranked — do not reorder. Player names include games played and per-game average where relevant.
${leagueCtx ? 'League context is provided — use roster and matchup data to personalize advice.' : ''}
${missingLeague ? 'NOTE: The user asked a league-specific question but has not connected their Sleeper account. Remind them to enter their Sleeper username using the Connect Sleeper button in the top-right corner of this page to unlock league-aware features. Still answer as helpfully as possible with the general data available.' : ''}

--- DATA CONTEXT ---
${dataContext}

--- NFL STATS ---
${statsBlock}

${leagueBlock}
--- TRENDING ADDS (last 24h) ---
${addsBlock}

--- TRENDING DROPS (last 24h) ---
${dropsBlock}
`;
}

function buildDataContext(plan: QueryPlan, hasLeague: boolean): string {
    const season = plan.season ?? CURRENT_SEASON;
    switch (plan.intent) {
        case 'top_position':
            return `Season totals for top ${plan.position ?? 'skill position'} players, ${plan.season ?? PREV_SEASON} season (min 6 games played).`;
        case 'player_vs_opponent':
            return `All regular season games for ${plan.players[0] ?? 'player'} against ${plan.opponent ?? 'opponent'}, all available seasons.`;
        case 'player_comparison':
            return `Recent game logs for ${plan.players.join(' and ')}, ${season} and ${season - 1} seasons.`;
        case 'player_recent':
            return `Last 10 regular season games for ${plan.players[0] ?? 'player'}.`;
        case 'air_yards_efficiency':
            return `${plan.position ?? 'WR'} air yards and receiving efficiency, last ${plan.weeksBack ?? 2} weeks of ${CURRENT_SEASON} season. Includes aDOT, YAC, air yards share.`;
        case 'workload_trend':
            return `Full ${CURRENT_SEASON} season game log for ${plan.players[0] ?? 'player'} in chronological order — use to identify workload trends.`;
        case 'efficiency_gap':
            return `${plan.position ?? 'WR'} players ranked by total targets vs fantasy points scored, ${CURRENT_SEASON} season. High targets + low points = buy-low candidate.`;
        case 'standings':
            return hasLeague
                ? `Live league standings provided from Sleeper. Answer directly from the standings data.`
                : `No league context available — answering with general data instead.`;
        case 'roster_scan':
            return hasLeague
                ? `League roster data provided. Analyze roster composition to identify trade opportunities.`
                : `No league context available — answering with general waiver data instead.`;
        case 'playoff_schedule':
            return hasLeague
                ? `League rosters and upcoming NFL schedule provided for playoff weeks analysis.`
                : `No league context available — answering with general schedule data instead.`;
        case 'trending':
            return `Most recent week top performers + Sleeper trending data (last 24h).`;
        default:
            return `Most recent week top performers by fantasy points (PPR).`;
    }
}

// ── Model helpers ─────────────────────────────────────────────────────────────

function isGeminiRateLimitError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('rate limit');
}

function isGroqRateLimitError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit') ||
        ('status' in err && (err as { status: number }).status === 429);
}

async function streamGemini(systemPrompt: string, messages: { role: string; content: string }[]): Promise<ReadableStream<Uint8Array>> {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: systemPrompt });
    const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));
    const lastMessage = messages[messages.length - 1];
    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage.content);
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                for await (const chunk of result.stream) {
                    const text = chunk.text();
                    if (text) controller.enqueue(encoder.encode(text));
                }
            } catch (err) { controller.error(err); }
            finally { controller.close(); }
        },
    });
}

async function streamGroq(systemPrompt: string, messages: { role: string; content: string }[]): Promise<ReadableStream<Uint8Array>> {
    const stream = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 512,
    });
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                for await (const chunk of stream) {
                    const text = chunk.choices[0]?.delta?.content ?? '';
                    if (text) controller.enqueue(encoder.encode(text));
                }
            } catch (err) { controller.error(err); }
            finally { controller.close(); }
        },
    });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
    const body = (await req.json()) as {
        messages?: { role: string; content: string }[];
        sleeperLeagueId?: string;  // Phase 2: Sleeper league ID from client
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    const clientId = getClientId(req);
    const { allowed, remaining, resetAt } = checkHourlyLimit(clientId);
    if (!allowed) {
        return NextResponse.json(
            { error: 'Hourly prompt limit reached. Please wait before sending more prompts.', resetAt },
            { status: 429, headers: { 'X-RateLimit-Limit': String(HOURLY_LIMIT), 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetAt) } },
        );
    }

    if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: 'No AI API keys are configured' }, { status: 500 });
    }

    const messages = body.messages.slice(-6);
    const latestUserMessage = messages.filter((m) => m.role === 'user').pop()?.content ?? '';

    // Pass 1 — classify intent
    const plan = await classifyIntent(latestUserMessage);
    console.log('[pass-1] query plan:', JSON.stringify(plan));

    // Fetch all context in parallel — DB stats, Sleeper trending, player map, league context
    const [stats, { adds: trendingAdds, drops: trendingDrops }, playerMap] = await Promise.all([
        executeQueryPlan(plan),
        fetchTrending(),
        fetchSleeperPlayerMap(),
    ]);

    // Phase 2: fetch league context only if sleeperLeagueId provided and intent benefits from it
    const leagueAwareIntents: QueryIntent[] = ['standings', 'roster_scan', 'playoff_schedule', 'trending', 'player_comparison'];
    const needsLeague = leagueAwareIntents.includes(plan.intent);
    const leagueCtx = (body.sleeperLeagueId && needsLeague)
        ? await fetchLeagueContext(body.sleeperLeagueId, playerMap)
        : null;
    // If intent needs league context but no Sleeper ID was provided, flag it
    const missingLeague = needsLeague && !body.sleeperLeagueId;

    const dataContext = buildDataContext(plan, leagueCtx !== null);
    const systemPrompt = buildSystemPrompt(stats, trendingAdds, trendingDrops, playerMap, plan, dataContext, leagueCtx, missingLeague);

    incrementDaily();
    const dailyCount = getDailyCount();

    // Pass 2 — stream the answer
    let readable: ReadableStream<Uint8Array>;
    let modelUsed: ModelUsed = 'groq';
    let fallbackReason: string | null = null;

    try {
        if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
        readable = await streamGroq(systemPrompt, messages);
    } catch (groqErr) {
        const isRateLimit = isGroqRateLimitError(groqErr);
        if (!isRateLimit || !process.env.GEMINI_API_KEY) {
            const message = groqErr instanceof Error ? groqErr.message : 'Groq API error';
            return NextResponse.json({ error: message }, { status: 502 });
        }
        fallbackReason = 'groq_rate_limit';
        try {
            readable = await streamGemini(systemPrompt, messages);
            modelUsed = 'gemini';
        } catch (geminiErr) {
            const message = geminiErr instanceof Error ? geminiErr.message : 'Gemini API error';
            return NextResponse.json({ error: message }, { status: 502 });
        }
    }

    const headers: Record<string, string> = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
        'X-Model-Used': modelUsed,
        'X-RateLimit-Limit': String(HOURLY_LIMIT),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(resetAt),
        'X-Daily-Prompts-Used': String(dailyCount),
        'X-Query-Intent': plan.intent,
        'X-League-Context': leagueCtx ? 'true' : 'false',
    };
    if (fallbackReason) headers['X-Fallback-Reason'] = fallbackReason;

    return new Response(readable, { headers });
}