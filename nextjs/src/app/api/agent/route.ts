// src/app/api/agent/route.ts
//
// POST /api/agent — AI fantasy football assistant, two-pass architecture.
//
// ── Overview ──────────────────────────────────────────────────────────────────
// The agent answers fantasy football questions by combining structured DB data
// with live Sleeper trending and an LLM. It runs two sequential AI calls per
// request:
//
//   Pass 1 — Intent classification (Groq, llama-3.1-8b-instant, temp=0)
//     A lightweight "planner" prompt classifies the user's question into one of
//     twelve QueryIntent values and extracts structured entities (players,
//     position, opponent, season, weeksBack). This structured plan is then used
//     to fetch precisely the right data from the DB — avoiding the need to dump
//     all stats into the prompt context.
//
//   Pass 2 — Answer generation (Groq primary, Gemini fallback, streaming)
//     The final system prompt is assembled from DB stats, Sleeper trending data,
//     an optional league context block, and the intent-specific data description.
//     The model streams its response back to the client as plain text.
//
// ── Data sources ──────────────────────────────────────────────────────────────
//   • NflWeeklyStat DB table   — local copy of nfl_data_py stats, populated by
//                                the Python FastAPI service on Railway/Render.
//   • Sleeper trending API     — top adds/drops in the last 24 h (cached 10 min).
//   • Sleeper player map       — player_id → full name (cached 24 h, stored in DB).
//   • League context           — rosters, standings, upcoming matchups from Sleeper
//                                (fetched only for league-aware intents).
//
// ── Rate limiting ────────────────────────────────────────────────────────────
//   • Per-client: HOURLY_LIMIT prompts per rolling 60-minute window (in-memory).
//   • Global daily counter:  logged in response headers for observability.
//   Response headers expose limit/remaining/reset so the client can show a
//   countdown to the user when they approach the cap.
//
// ── Model fallback ────────────────────────────────────────────────────────────
//   Groq is the primary model. If Groq fails for ANY reason — rate limit, bad
//   or revoked key, retired model ID, outage — and a GEMINI_API_KEY is
//   configured, the request is retried on Gemini 2.5 Flash. If GROQ_API_KEY is
//   absent entirely, Gemini serves the request directly. The X-Model-Used and
//   X-Fallback-Reason (groq_rate_limit | groq_error | groq_unavailable) response
//   headers record which path was taken. Only when every configured provider
//   fails does the route return 502, and the body carries each provider's error
//   so the browser can show what actually went wrong.
//
//   Groq model IDs are discovered from the account's own catalogue rather than
//   hardcoded, because a retired ID 404s every request and reads as an outage.
//   GET /api/agent?live=1 reports what each key can actually reach.
//
// ── League context (Phase 2) ─────────────────────────────────────────────────
//   If the client includes `sleeperLeagueId` in the request body AND the
//   classified intent is league-aware (standings, roster_scan, etc.), the route
//   fetches live roster/standings data from Sleeper and injects it into the
//   system prompt so the model can answer questions about the user's specific
//   league. If the intent needs league context but no Sleeper ID was supplied,
//   the model is told to prompt the user to connect their account.
//
// ── Environment variables ─────────────────────────────────────────────────────
//   GROQ_API_KEY    — primary provider for Pass 1 and Pass 2. Optional if
//                     GEMINI_API_KEY is set; at least one of the two is required.
//   GEMINI_API_KEY  — fallback provider for Pass 1 and Pass 2. Optional if
//                     GROQ_API_KEY is set.
//   GROQ_MODEL      — optional. Pins the Groq model for both passes; without it
//                     the model is discovered from the account's catalogue.
//   GROQ_PLANNER_MODEL — optional. Pins Pass 1 only.
//   GEMINI_MODEL    — optional model ID override (default gemini-2.5-flash).
//   NFL_SEASON      — current NFL season year (e.g. 2025); defaults to the
//                     current calendar year. Set this explicitly — stale values
//                     are the most common cause of wrong season data.

import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import {
  HOURLY_LIMIT, getClientId, checkHourlyLimit, getDailyCount, incrementDaily,
} from '@/lib/rateLimit';
import {
  fetchTrending, fetchSleeperPlayerMap, fetchLeagueContext,
} from '@/lib/agentContext';
import type { TrendingPlayer, LeagueContext } from '@/lib/agentContext';
import { err } from '@/lib/api';

// ── Clients ───────────────────────────────────────────────────────────────────
//
// Both clients are built lazily, on first use, and only when their key is set.
// `new Groq({ apiKey: undefined })` THROWS, so constructing it at module scope
// crashed the whole module whenever GROQ_API_KEY was missing — every request
// then 500'd before reaching the route's own "no AI API keys are configured"
// guard, and the browser could only report "Agent failed to respond".

let groqClient:   { key: string; client: Groq } | null = null;
let geminiClient: { key: string; client: GoogleGenerativeAI } | null = null;

/** Returns a Groq client, or null when GROQ_API_KEY is not configured. */
function getGroq(): Groq | null {
    const key = process.env.GROQ_API_KEY?.trim();
    if (!key) return null;
    if (groqClient?.key !== key) groqClient = { key, client: new Groq({ apiKey: key }) };
    return groqClient.client;
}

/** Returns a Gemini client, or null when GEMINI_API_KEY is not configured. */
function getGemini(): GoogleGenerativeAI | null {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) return null;
    if (geminiClient?.key !== key) geminiClient = { key, client: new GoogleGenerativeAI(key) };
    return geminiClient.client;
}

// ── Model selection ───────────────────────────────────────────────────────────
//
// Providers retire model IDs on their own schedule, and a retired ID answers
// every request with a 404 that looks exactly like an outage. So the Groq model
// is not a hardcoded constant: the candidates below are matched against the
// models the account can actually reach, and the first hit wins. An explicit
// GROQ_MODEL / GROQ_PLANNER_MODEL always overrides the search.

/** Answer pass (pass 2) — capable first, cheap last. */
const GROQ_ANSWER_CANDIDATES = [
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant',
];

/** Planner pass (pass 1) — a temp=0 JSON classification, so cheap first. */
const GROQ_PLANNER_CANDIDATES = [
    'llama-3.1-8b-instant',
    'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile',
    'meta-llama/llama-4-scout-17b-16e-instruct',
];

/** Model families on the Groq catalogue that cannot serve chat completions. */
const NON_CHAT_MODEL_PATTERN = /whisper|tts|guard|embed|prompt-?guard/i;

function geminiModel(): string {
    return process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
}

// Catalogue cache, keyed by API key so a rotated key re-reads it.
let groqCatalogue: { key: string; ids: string[] } | null = null;

/** Model IDs the configured Groq key can reach, or null if the list is unavailable. */
async function groqModelIds(): Promise<string[] | null> {
    const client = getGroq();
    const key = process.env.GROQ_API_KEY?.trim();
    if (!client || !key) return null;
    if (groqCatalogue?.key === key) return groqCatalogue.ids;
    try {
        const listed = await client.models.list();
        const ids = (listed?.data ?? []).map((m) => m.id).filter(Boolean);
        if (!ids.length) return null;
        groqCatalogue = { key, ids };
        return ids;
    } catch (listErr) {
        // Not fatal: fall back to the first candidate and let the completion
        // call report the real problem.
        console.error('[groq] model catalogue unavailable:', listErr);
        return null;
    }
}

/**
 * Picks the model ID to use for a Groq pass.
 *
 * Order: explicit env override → first candidate the account offers → any chat
 * model the account offers → first candidate as a blind guess.
 */
async function resolveGroqModel(kind: 'planner' | 'answer'): Promise<string> {
    const override = kind === 'planner'
        ? (process.env.GROQ_PLANNER_MODEL?.trim() || process.env.GROQ_MODEL?.trim())
        : process.env.GROQ_MODEL?.trim();
    if (override) return override;

    const candidates = kind === 'planner' ? GROQ_PLANNER_CANDIDATES : GROQ_ANSWER_CANDIDATES;
    const ids = await groqModelIds();
    if (!ids) return candidates[0];
    const preferred = candidates.find((c) => ids.includes(c));
    if (preferred) return preferred;
    // Every ID we know about is gone — take whatever chat model is on offer
    // rather than failing on a name that is certainly dead.
    const usable = ids.find((id) => !NON_CHAT_MODEL_PATTERN.test(id));
    if (usable) console.warn(`[groq] no known model available — falling back to ${usable}`);
    return usable ?? candidates[0];
}

/** True for the 404 a retired or inaccessible model ID produces. */
function isModelNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return msg.includes('model_not_found') || msg.includes('does not exist');
}

// NFL_SEASON must be set to the most recently completed season (e.g. 2025).
// "Last year" queries resolve to PREV_SEASON. Missing or stale env var is the
// most common cause of wrong season data — verify in .env.local and production.
const CURRENT_SEASON = parseInt(process.env.NFL_SEASON ?? String(new Date().getFullYear()), 10);
const PREV_SEASON = CURRENT_SEASON - 1;

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

type ModelUsed = 'gemini' | 'groq';

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

/**
 * Looks up the Sleeper/GSIS player ID for a display name string.
 * Searches the NflWeeklyStat table for the most recent match so that
 * veteran players (who may have data from multiple seasons) are found correctly.
 *
 * @param name  Partial or full player display name (e.g. "Josh Allen").
 * @returns     The player's stable `playerId`, or null if not found.
 */
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

/**
 * Runs the intent-specific database query described by `plan` and returns
 * the matching stat rows. Each intent maps to a different Prisma query:
 *
 *   top_position       — season totals for the top players at a position.
 *   player_vs_opponent — all games a player has played against a specific team.
 *   player_comparison  — recent game logs for 2+ named players side-by-side.
 *   player_recent      — last 10 games for a single player.
 *   air_yards_efficiency — WR air yards / receiving efficiency last N weeks.
 *   workload_trend     — full season game log for a player in chronological order.
 *   efficiency_gap     — players with high targets but low fantasy point output.
 *   standings / roster_scan / playoff_schedule — no DB query needed; data comes
 *                        from the league context injected into the system prompt.
 *   trending / general — delegates to fallbackRecentStats().
 *
 * Falls back to the most-recent-week top scorers on any error.
 */
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

/**
 * Returns the top 25 fantasy scorers from the most recent week that has data
 * in the DB. Used as a fallback when the intent is `general` or `trending`, or
 * when a specific player/opponent cannot be resolved.
 */
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

/** Pass 1 on Groq. Returns the raw model text, or null if Groq is unusable. */
async function planWithGroq(userMessage: string): Promise<string | null> {
    const client = getGroq();
    if (!client) return null;
    const run = async (): Promise<string> => {
        const response = await client.chat.completions.create({
            model: await resolveGroqModel('planner'),
            messages: [
                { role: 'system', content: PLANNER_SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
            stream: false,
            temperature: 0,
            max_tokens: 150,
        });
        return response.choices[0]?.message?.content ?? '';
    };
    try {
        return await run();
    } catch (err) {
        if (isModelNotFoundError(err)) {
            // The cached catalogue named a model the account cannot use.
            // Re-read it once and try the replacement.
            groqCatalogue = null;
            try { return await run(); } catch (retryErr) {
                console.error('[pass-1] groq planner error after model refresh:', retryErr);
                return null;
            }
        }
        console.error('[pass-1] groq planner error:', err);
        return null;
    }
}

/** Pass 1 on Gemini — used when Groq is not configured or is failing. */
async function planWithGemini(userMessage: string): Promise<string | null> {
    const client = getGemini();
    if (!client) return null;
    try {
        const model = client.getGenerativeModel({ model: geminiModel(), systemInstruction: PLANNER_SYSTEM_PROMPT });
        const result = await model.generateContent(userMessage);
        return result.response.text();
    } catch (err) {
        console.error('[pass-1] gemini planner error:', err);
        return null;
    }
}

/**
 * Pass 1 — classifies the user's message into a structured QueryPlan using a
 * lightweight, temp=0 model call.
 *
 * Groq is tried first; if it is unconfigured or failing, Gemini classifies
 * instead, so a single dead provider does not silently downgrade every question
 * to the `general` intent (which would strip league-aware answers of their
 * standings and roster data).
 *
 * The model is given a strict JSON output schema via the PLANNER_SYSTEM_PROMPT.
 * The result is validated before use: unknown intent values fall back to
 * `{ intent: 'general' }` so a bad classification never crashes the query step.
 *
 * @param userMessage  The latest user message from the conversation.
 * @returns  A QueryPlan with validated intent and extracted entities.
 */
async function classifyIntent(userMessage: string): Promise<QueryPlan> {
    const fallback: QueryPlan = { intent: 'general', players: [], position: null, opponent: null, season: null, weeksBack: null };
    const raw = (await planWithGroq(userMessage)) ?? (await planWithGemini(userMessage));
    if (raw === null) {
        console.error('[pass-1] no planner provider available — defaulting to general intent');
        return fallback;
    }
    try {
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

/**
 * Formats a single PlayerStats record into a compact one-line string suitable
 * for injection into the LLM system prompt.
 *
 * Example output:
 *   "Josh Allen (QB) BUF Wk5 2025 | 31.4pts, 312PassYds, 3PassTD, 8Car, 42RushYds"
 *
 * Phase 1 fields (air yards, YAC, RACR, WOPR) are included when present.
 * aDOT (average depth of target) is derived inline when both air yards and
 * targets are available.
 */
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

/**
 * Assembles the full system prompt for Pass 2 (the answer-generation call).
 *
 * Sections injected:
 *   DATA CONTEXT  — plain-English description of what the NFL stats represent.
 *   NFL STATS     — numbered list of formatted stat rows from executeQueryPlan.
 *   LEAGUE CONTEXT — rosters, standings, and upcoming matchups (when available).
 *   TRENDING ADDS/DROPS — top Sleeper waiver activity from the last 24 h.
 *
 * When the user asked a league-specific question but hasn't connected their
 * Sleeper account, a `missingLeague` notice is added so the model can prompt
 * them to connect rather than giving a generic (wrong) answer.
 */
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

/**
 * Returns a short plain-English description of the data included in the system
 * prompt for the current intent. This is shown to the LLM as a "DATA CONTEXT"
 * header so it understands what the stat rows represent before it sees them.
 */
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

function isGroqRateLimitError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit') ||
        ('status' in err && (err as { status: number }).status === 429);
}

/** A provider's answer stream, plus the model ID that actually served it. */
interface StreamResult {
    stream: ReadableStream<Uint8Array>;
    model: string;
}

/** Shown when a provider completes without emitting a single token. */
const EMPTY_ANSWER_NOTE =
    'The model returned an empty response. Please try rephrasing your question.';

/**
 * Wraps an async iterable of text chunks in a ReadableStream of UTF-8 bytes.
 *
 * Response headers are already flushed by the time the first chunk is pulled,
 * so a mid-stream provider failure can no longer become an HTTP error status.
 * It is written into the stream as readable text instead — erroring the stream
 * gives the browser nothing but a generic failure, and discards whatever the
 * model had already produced.
 *
 * A provider that finishes without emitting anything gets the same treatment,
 * so the user never sees a silent, empty assistant bubble.
 */
function toReadableStream(chunks: AsyncIterable<string>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        async start(controller) {
            let sent = false;
            const push = (text: string): void => {
                // The client may have navigated away, which closes the stream
                // from under us — that is not an error worth propagating.
                try { controller.enqueue(encoder.encode(text)); sent = true; } catch { /* consumer gone */ }
            };
            try {
                for await (const text of chunks) {
                    if (text) push(text);
                }
                if (!sent) push(EMPTY_ANSWER_NOTE);
            } catch (streamErr) {
                console.error('[pass-2] stream error:', streamErr);
                const message = streamErr instanceof Error ? streamErr.message : 'unknown error';
                push(sent
                    ? `\n\n⚠ Response interrupted: ${message}`
                    : `⚠ The AI service dropped the response: ${message}`);
            } finally {
                try { controller.close(); } catch { /* already closed */ }
            }
        },
    });
}

/**
 * Streams a Gemini response using the Google Generative AI SDK.
 * Used whenever Groq is unavailable or fails.
 *
 * The conversation history is passed as a chat session (multi-turn) with the
 * last message sent via `sendMessageStream` for streaming output.
 *
 * @returns  A ReadableStream of UTF-8 encoded text chunks.
 */
async function streamGemini(systemPrompt: string, messages: { role: string; content: string }[]): Promise<StreamResult> {
    const client = getGemini();
    if (!client) throw new Error('GEMINI_API_KEY is not configured');
    const modelId = geminiModel();
    const model = client.getGenerativeModel({ model: modelId, systemInstruction: systemPrompt });
    const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));
    const lastMessage = messages[messages.length - 1];
    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage.content);
    return {
        model: modelId,
        stream: toReadableStream((async function* () {
            for await (const chunk of result.stream) {
                yield chunk.text();
            }
        })()),
    };
}

/**
 * Streams a Groq response for Pass 2 — the primary answer-generation path.
 *
 * Only the last 6 messages from the conversation are passed (sliding window)
 * to keep the prompt within token limits while preserving short-term context.
 *
 * @returns  A ReadableStream of UTF-8 encoded text chunks.
 */
async function streamGroq(systemPrompt: string, messages: { role: string; content: string }[]): Promise<StreamResult> {
    const client = getGroq();
    if (!client) throw new Error('GROQ_API_KEY is not configured');
    let modelId = '';
    const open = async () => client.chat.completions.create({
        model: (modelId = await resolveGroqModel('answer')),
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 512,
    });

    let stream;
    try {
        stream = await open();
    } catch (openErr) {
        // A retired model ID 404s every request until the catalogue is re-read,
        // which is exactly the failure this whole path exists to survive.
        if (!isModelNotFoundError(openErr)) throw openErr;
        console.warn('[pass-2] model rejected — refreshing the Groq catalogue');
        groqCatalogue = null;
        stream = await open();
    }

    return {
        model: modelId,
        stream: toReadableStream((async function* () {
            for await (const chunk of stream) {
                yield chunk.choices[0]?.delta?.content ?? '';
            }
        })()),
    };
}

// ── Route handler ─────────────────────────────────────────────────────────────

// Two sequential model calls plus Sleeper and DB context do not fit in the 10 s
// default serverless budget on a cold cache. Exceeding it kills the function
// mid-request and the browser sees a 504 with an HTML body — indistinguishable,
// from the user's side, from the assistant being broken.
export const maxDuration = 60;

/** Live check: can the Groq key list models, and which one would be used? */
async function probeGroq(): Promise<Record<string, unknown>> {
    if (!getGroq()) return { configured: false };
    const ids = await groqModelIds();
    if (!ids) return { configured: true, reachable: false, error: 'Could not list models — see server logs for the provider error.' };
    return {
        configured: true,
        reachable:  true,
        selected:   { planner: await resolveGroqModel('planner'), answer: await resolveGroqModel('answer') },
        available:  ids.filter((id) => !NON_CHAT_MODEL_PATTERN.test(id)).sort(),
    };
}

/** Live check: is the Gemini key valid, and is the configured model on offer? */
async function probeGemini(): Promise<Record<string, unknown>> {
    const wanted = geminiModel();
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) return { configured: false };
    try {
        // Key goes in the header, never the URL, so it cannot end up in a log.
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
            headers: { 'x-goog-api-key': key },
            signal:  AbortSignal.timeout(8000),
        });
        if (!res.ok) {
            const detail = (await res.text()).slice(0, 300);
            return { configured: true, reachable: false, model: wanted, error: `HTTP ${res.status}: ${detail}` };
        }
        const body = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
        const available = (body.models ?? [])
            .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m) => (m.name ?? '').replace(/^models\//, ''))
            .filter(Boolean)
            .sort();
        return {
            configured: true,
            reachable:  true,
            model:      wanted,
            modelExists: available.includes(wanted),
            available,
        };
    } catch (probeErr) {
        const message = probeErr instanceof Error ? probeErr.message : 'unknown error';
        return { configured: true, reachable: false, model: wanted, error: message };
    }
}

/**
 * GET /api/agent — configuration probe.
 *
 * Default: a free, offline summary of which providers are configured.
 * `?live=1`: actually calls each provider to report whether the key works and
 * which model IDs it can reach — the two things a 404 or a 400 from inside a
 * streaming answer cannot tell you.
 *
 * Exposes booleans, model IDs and provider error text only, never key material.
 */
export async function GET(req: NextRequest): Promise<Response> {
    const session = await auth();
    if (!session) return err('Unauthorized', 401);

    const groqReady   = getGroq()   !== null;
    const geminiReady = getGemini() !== null;

    if (new URL(req.url).searchParams.get('live') !== '1') {
        return NextResponse.json({
            ready:     groqReady || geminiReady,
            providers: { groq: groqReady, gemini: geminiReady },
            season:    CURRENT_SEASON,
            hint:      'Add ?live=1 to test the keys against each provider.',
        });
    }

    const [groqStatus, geminiStatus] = await Promise.all([probeGroq(), probeGemini()]);
    return NextResponse.json({
        ready:  groqStatus.reachable === true || geminiStatus.reachable === true,
        groq:   groqStatus,
        gemini: geminiStatus,
        season: CURRENT_SEASON,
    });
}

export async function POST(req: NextRequest): Promise<Response> {
    try {
        return await handlePost(req);
    } catch (routeErr) {
        // Anything unhandled below would otherwise escape as a framework 500
        // with an HTML body, which the client can only report as a generic
        // "Agent failed to respond".
        console.error('[agent] unhandled route error:', routeErr);
        const message = routeErr instanceof Error ? routeErr.message : 'Unexpected server error';
        return err(`The assistant could not complete this request: ${message}`, 500);
    }
}

async function handlePost(req: NextRequest): Promise<Response> {
    const session = await auth();
    if (!session) return err('Your session has expired. Please sign in again.', 401);

    let body: {
        messages?: { role: string; content: string }[];
        sleeperLeagueId?: string;  // Phase 2: Sleeper league ID from client
    };
    try {
        body = (await req.json()) as typeof body;
    } catch {
        return err('Request body must be valid JSON', 400);
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return err('messages array is required', 400);
    }

    const clientId = getClientId(req);
    const { allowed, remaining, resetAt } = checkHourlyLimit(clientId);
    if (!allowed) {
        return NextResponse.json(
            { error: 'Hourly prompt limit reached. Please wait before sending more prompts.', resetAt },
            { status: 429, headers: { 'X-RateLimit-Limit': String(HOURLY_LIMIT), 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetAt) } },
        );
    }

    const groqReady   = getGroq()   !== null;
    const geminiReady = getGemini() !== null;
    if (!groqReady && !geminiReady) {
        return err('No AI provider is configured — set GROQ_API_KEY or GEMINI_API_KEY on the server.', 503);
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
        ? await fetchLeagueContext(body.sleeperLeagueId, playerMap, CURRENT_SEASON)
        : null;
    // If intent needs league context but no Sleeper ID was provided, flag it
    const missingLeague = needsLeague && !body.sleeperLeagueId;

    const dataContext = buildDataContext(plan, leagueCtx !== null);
    const systemPrompt = buildSystemPrompt(stats, trendingAdds, trendingDrops, playerMap, plan, dataContext, leagueCtx, missingLeague);

    incrementDaily();
    const dailyCount = getDailyCount();

    // Pass 2 — stream the answer.
    //
    // Groq is primary; Gemini takes over on ANY Groq failure, not just a 429.
    // A revoked key, a retired model ID, or a Groq outage used to take the whole
    // assistant down even with a healthy Gemini key sitting right there.
    let answer: StreamResult | null = null;
    let modelUsed: ModelUsed = 'groq';
    let fallbackReason: string | null = null;
    const failures: string[] = [];

    if (groqReady) {
        try {
            answer = await streamGroq(systemPrompt, messages);
        } catch (groqErr) {
            const message = groqErr instanceof Error ? groqErr.message : 'Groq API error';
            console.error('[pass-2] groq error:', groqErr);
            failures.push(`Groq: ${message}`);
            fallbackReason = isGroqRateLimitError(groqErr) ? 'groq_rate_limit' : 'groq_error';
        }
    } else {
        fallbackReason = 'groq_unavailable';
    }

    if (!answer) {
        if (!geminiReady) {
            return err(failures.length
                ? `The AI service is unavailable — ${failures.join('; ')}`
                : 'The AI service is unavailable — GROQ_API_KEY is not configured and there is no fallback provider.', 502);
        }
        try {
            answer = await streamGemini(systemPrompt, messages);
            modelUsed = 'gemini';
        } catch (geminiErr) {
            const message = geminiErr instanceof Error ? geminiErr.message : 'Gemini API error';
            console.error('[pass-2] gemini error:', geminiErr);
            failures.push(`Gemini: ${message}`);
            return err(`Every AI provider failed — ${failures.join('; ')}`, 502);
        }
    }

    const headers: Record<string, string> = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',        // don't let a proxy buffer the stream
        'X-Model-Used': modelUsed,
        'X-Model-Id': answer.model,
        'X-RateLimit-Limit': String(HOURLY_LIMIT),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(resetAt),
        'X-Daily-Prompts-Used': String(dailyCount),
        'X-Query-Intent': plan.intent,
        'X-League-Context': leagueCtx ? 'true' : 'false',
    };
    if (fallbackReason) headers['X-Fallback-Reason'] = fallbackReason;

    return new Response(answer.stream, { headers });
}
