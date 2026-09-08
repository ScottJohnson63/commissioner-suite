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
//     the QueryIntent values and extracts structured entities (players,
//     position, opponent, season, weeksBack). This structured plan is then used
//     to fetch precisely the right data from the DB — avoiding the need to dump
//     all stats into the prompt context — and to decide which of the dashboard
//     panels the answer needs. The six openers the page offers skip this pass
//     entirely: their plans are written down in src/lib/agentIntents.ts, which
//     the page reads too, so the button and the route cannot disagree.
//
//   Pass 2 — Answer generation (Groq primary, Gemini fallback, streaming)
//     The final system prompt is assembled from DB stats, Sleeper trending data,
//     an optional league context block, and the intent-specific data description.
//     The model streams its response back to the client as plain text.
//
// ── Data sources ──────────────────────────────────────────────────────────────
//   • NflWeeklyStat DB table   — local copy of nfl_data_py stats, populated by
//                                the Python FastAPI service on Railway/Render.
//   • Sleeper trending API     — top adds/drops in the last 24 h (cached 10 min),
//                                labelled with each player's position and team.
//   • Sleeper player index     — player_id → name/position/team (cached 24 h, in DB).
//   • League context           — rosters, standings, upcoming matchups from Sleeper
//                                (fetched only for league-aware intents).
//   • Dashboard panels         — the Matchup, Waiver and Trade routes, called
//                                in-process for the asker's own roster. See
//                                src/lib/agentTools.ts for why these and not a
//                                second implementation of the same analysis.
//
// ── Rate limiting ────────────────────────────────────────────────────────────
//   • Per-client: HOURLY_LIMIT prompts per rolling 60-minute window (in-memory).
//   • App-wide:   DAILY_LIMIT prompts per UTC day, the app's copy of the
//                 answering provider's daily quota. Reaching ours first is the
//                 point: the reader gets our message rather than a provider 429
//                 from inside a half-written answer.
//   Response headers expose both limits with their remaining counts and reset
//   times, and GET ?usage=1 reports the same buckets without spending from them
//   so a page reload does not draw an empty meter over a window already gone.
//
// ── Model fallback ────────────────────────────────────────────────────────────
//   Gemini answers first and Groq is the fallback, which is a quota decision
//   rather than a quality one: a panel-backed prompt runs 5,000-9,000 tokens,
//   and Groq's free tier allows 100,000 a day on its largest model — about a
//   dozen answers for a whole league. Set AGENT_PRIMARY=groq to reverse it,
//   which is right on a paid Groq plan, where it is much the faster of the two.
//
//   Whichever leads, a failure of ANY kind moves to the other: a rate limit, a
//   revoked key, a retired model ID, an outage. Groq is additionally DEFERRED
//   when the prompt is larger than AGENT_GROQ_TPM, since its per-minute ceiling
//   refuses an oversized prompt outright — and does so selectively, answering
//   NFL questions and refusing the roster ones. Deferred, not ruled out: if
//   nothing else answers, the oversized request is made anyway, because a 429
//   that might not happen beats an error that certainly will.
//
//   X-Model-Used and X-Fallback-Reason (groq_rate_limit | groq_error |
//   groq_unavailable | groq_prompt_too_large | gemini_error |
//   gemini_unavailable) record which path was taken, and X-Prompt-Tokens says
//   what the request cost to ask. Only when every configured provider fails does
//   the route return 502, and the body carries each provider's error so the
//   browser can show what actually went wrong.
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
//   AGENT_PRIMARY   — optional. 'groq' to answer on Groq first; anything else
//                     (or unset) answers on Gemini first.
//   AGENT_GROQ_TPM  — optional. Largest prompt, in tokens, worth sending to
//                     Groq while another provider might answer. Default 12000,
//                     the free tier's per-minute ceiling on llama-3.3-70b.
//                     0 disables the check. Never blocks a last-resort attempt.
//   AGENT_DAILY_LIMIT — optional. App-wide prompts per UTC day; default 250.
//                     Set it to the answering provider's real daily quota.
//   NFL_SEASON      — current NFL season year (e.g. 2025); defaults to the
//                     current calendar year. Set this explicitly — stale values
//                     are the most common cause of wrong season data.

import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import {
  HOURLY_LIMIT, DAILY_LIMIT, getClientId, checkHourlyLimit, peekHourlyLimit,
  checkDailyLimit, dailyResetAt, getDailyCount, incrementDaily,
} from '@/lib/rateLimit';
import {
  VALID_INTENTS, emptyPlan, plannerShortcut,
} from '@/lib/agentIntents';
import type { QueryIntent, QueryPlan } from '@/lib/agentIntents';
import {
  fetchTrending, fetchSleeperPlayerIndex, fetchLeagueContext,
} from '@/lib/agentContext';
import type { TrendingPlayer, LeagueContext, PlayerIdentity } from '@/lib/agentContext';
import { fetchAgentTools, formatAgentTools } from '@/lib/agentTools';
import type { AgentTools, ToolRequest } from '@/lib/agentTools';
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
//
// QueryIntent and QueryPlan moved to src/lib/agentIntents.ts, which the page
// reads too: the six openers it shows are recognised here by their exact text
// and answered without a classification call, and the two lists cannot be
// allowed to drift apart.

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
                    // Every one of these rows goes straight into the prompt, and
                    // this is the only query where nothing else bounds them:
                    // there is no season filter, and the opponent is matched by
                    // substring, so a planner that answers "LA" matches LA, LAR
                    // and LAC, and one that answers a single letter matches most
                    // of the league. Twenty games is more than any answer needs.
                    take: 20,
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

            // Phase 3: the panel answers these. The stat rows alongside it are
            // the rest of the position for comparison — a start/sit call on a
            // bench RB reads better next to what the position is doing than
            // next to the week's overall top 25, which is mostly quarterbacks.
            case 'start_sit':
            case 'waiver_wire':
            case 'trade_analyzer':
                // A shorter list than the intents that have nothing else: here
                // the stat rows are only the comparison set beside the panel's
                // own numbers, and the twelfth-best RB of the last three weeks
                // has never changed a start/sit call.
                return plan.position
                    ? positionRecentForm(plan.position, plan.weeksBack ?? 3, 12)
                    : fallbackRecentStats(12);

            // "Which QBs are trending up?" is a question about form, and the
            // Sleeper add counts alone cannot answer it — they are a popularity
            // list that on any given day may contain no quarterback at all.
            // These are the players whose own scoring is actually rising.
            case 'trending':
                return plan.position
                    ? positionRisers(plan.position, plan.weeksBack ?? 2)
                    : fallbackRecentStats();

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
 * The most recent week the stat table actually holds for a season.
 *
 * Everything below is measured backwards from here rather than from the NFL's
 * current week: the sync runs behind live play, and a window anchored on the
 * calendar reads empty for the days between a Sunday and the sync that follows
 * it.
 */
async function latestLoadedWeek(season: number): Promise<number | null> {
    const latest = await prisma.nflWeeklyStat.findFirst({
        where: { season, week: { gte: 1, lte: 18 } },
        orderBy: { week: 'desc' },
        select: { week: true },
    });
    return latest?.week ?? null;
}

/** Per-player totals over a week range, used by both position queries below. */
interface PositionForm {
    row: PlayerStats;
    recentPts: number;
    recentGames: number;
    priorPts: number;
    priorGames: number;
}

/**
 * Aggregates one position's scoring over the last `recentWeeks` weeks and the
 * three weeks before them.
 *
 * Falls back to the previous season when the current one has no rows yet —
 * between February and September that is every week, and a form question
 * answered with "no data" for seven months of the year is not an answer.
 */
async function positionForm(
    position: string,
    recentWeeks: number,
): Promise<{ forms: PositionForm[]; season: number; fromWeek: number; toWeek: number }> {
    const pos = position.toUpperCase();
    let season = CURRENT_SEASON;
    let maxWeek = await latestLoadedWeek(season);
    if (maxWeek === null) {
        season = PREV_SEASON;
        maxWeek = await latestLoadedWeek(season);
    }
    if (maxWeek === null) return { forms: [], season, fromWeek: 0, toWeek: 0 };

    const recentFrom = Math.max(1, maxWeek - recentWeeks + 1);
    const priorFrom  = Math.max(1, recentFrom - 3);

    const rows = await prisma.nflWeeklyStat.findMany({
        where: { season, position: pos, week: { gte: priorFrom, lte: maxWeek } },
        orderBy: [{ playerId: 'asc' }, { week: 'asc' }],
        select: STAT_SELECT,
    });

    const byPlayer = new Map<string, PositionForm>();
    for (const r of rows) {
        const entry = byPlayer.get(r.playerId)
            ?? { row: r, recentPts: 0, recentGames: 0, priorPts: 0, priorGames: 0 };
        const pts = r.fantasyPointsPpr ?? 0;
        if ((r.week ?? 0) >= recentFrom) {
            entry.recentPts += pts;
            entry.recentGames += 1;
            // Keep the most recent row as the identity — team changes mid-season.
            entry.row = r;
        } else {
            entry.priorPts += pts;
            entry.priorGames += 1;
        }
        byPlayer.set(r.playerId, entry);
    }
    return { forms: [...byPlayer.values()], season, fromWeek: priorFrom, toWeek: maxWeek };
}

/**
 * Players at a position whose scoring is rising, steepest first.
 *
 * "Trending up" is the last `recentWeeks` weeks against the three before them.
 * A player with no earlier games is kept with a zero baseline and labelled — a
 * debut or a return from injury is exactly what the question is looking for,
 * and dropping them would leave the list to established starters only.
 */
async function positionRisers(position: string, recentWeeks: number): Promise<PlayerStats[]> {
    const { forms } = await positionForm(position, recentWeeks);
    return forms
        .filter((f) => f.recentGames > 0)
        .map((f) => {
            const recentAvg = f.recentPts / f.recentGames;
            const priorAvg  = f.priorGames > 0 ? f.priorPts / f.priorGames : 0;
            return { form: f, recentAvg, priorAvg, delta: recentAvg - priorAvg };
        })
        // A rise from nothing to nothing is not a rise. One usable game is the bar.
        .filter((f) => f.recentAvg > 0)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 12)
        .map(({ form, recentAvg, priorAvg, delta }) => ({
            ...form.row,
            fantasyPointsPpr: parseFloat(recentAvg.toFixed(1)),
            playerDisplayName: `${form.row.playerDisplayName ?? form.row.playerName} `
                + `(last ${form.recentGames}g ${recentAvg.toFixed(1)}/g vs `
                + `${form.priorGames > 0 ? `prior ${form.priorGames}g ${priorAvg.toFixed(1)}/g` : 'no earlier games'}, `
                + `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}/g)`,
        }));
}

/**
 * One position's recent scoring leaders, best first.
 *
 * The comparison set for a start/sit, waiver or trade answer: what this
 * position has actually been worth lately, so a projection on the panel has
 * something to be measured against.
 */
async function positionRecentForm(position: string, recentWeeks: number, limit = 20): Promise<PlayerStats[]> {
    const { forms } = await positionForm(position, recentWeeks);
    return forms
        .filter((f) => f.recentGames > 0)
        .map((f) => ({ form: f, avg: f.recentPts / f.recentGames }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, limit)
        .map(({ form, avg }) => ({
            ...form.row,
            fantasyPointsPpr: parseFloat(avg.toFixed(1)),
            playerDisplayName: `${form.row.playerDisplayName ?? form.row.playerName} (${form.recentGames}g, ${avg.toFixed(1)}/g avg)`,
        }));
}

/**
 * Returns the top 25 fantasy scorers from the most recent week that has data
 * in the DB. Used as a fallback when the intent is `general` or `trending`, or
 * when a specific player/opponent cannot be resolved.
 */
async function fallbackRecentStats(limit = 25): Promise<PlayerStats[]> {
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
            take: limit,
            select: STAT_SELECT,
        }) as unknown as PlayerStats[];
    } catch { return []; }
}

// ── Pass 1 — intent classification ───────────────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `You are a query planner for a fantasy football AI assistant.
Analyze the user's question and output ONLY a JSON object — no explanation, no markdown, no backticks.

Output schema:
{
  "intent": one of: "top_position" | "player_vs_opponent" | "player_comparison" | "player_recent" | "air_yards_efficiency" | "workload_trend" | "efficiency_gap" | "standings" | "roster_scan" | "playoff_schedule" | "start_sit" | "waiver_wire" | "trade_analyzer" | "trending" | "general",
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
- start_sit: ANY lineup question about the asker's own team this week — "should I start or sit my RB", "who do I start at flex", "am I going to win this week", "how does my matchup look", "is my QB a good play". Use it even when no player is named: the asker's roster and this week's projections are looked up for them.
- waiver_wire: who to pick up, drop, or claim; free agents; "who's available"; "who should I add"
- trade_analyzer: trade proposals, trade targets, buy/sell, "who should I trade for", "is this trade fair"
- trending: what the wider fantasy world is adding or dropping, "who is trending up/down", hot names. Set "position" when the question names one ("which QBs are trending up" → "QB").
- general: anything else — only use this if no other intent fits

Position rules:
- Set "position" whenever the question names a position group, INCLUDING when the player is not named: "my running back" → "RB", "which QBs" → "QB", "a receiver" → "WR", "my tight end" → "TE".
- "players" is for NAMED players only. Never invent a name from a position phrase like "my running back".

IMPORTANT: If the question mentions "our league", "my league", "the league", "first place", "last place", or "standings", always use standings, roster_scan, or playoff_schedule — never general.
IMPORTANT: "my", "I", "me", "should I" plus a lineup, waiver or trade word means the asker's own team — use start_sit, waiver_wire or trade_analyzer, never general.`;

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
    const fallback = emptyPlan();

    // The page's own openers need no classifying — see src/lib/agentIntents.ts.
    // This is the most-travelled path in the app and it now costs nothing.
    const shortcut = plannerShortcut(userMessage);
    if (shortcut) {
        console.log('[pass-1] shortcut hit — no model call');
        return shortcut;
    }

    const raw = (await planWithGroq(userMessage)) ?? (await planWithGemini(userMessage));
    if (raw === null) {
        console.error('[pass-1] no planner provider available — defaulting to general intent');
        return fallback;
    }
    try {
        console.log('[pass-1] raw planner output:', raw);
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean) as QueryPlan;
        if (!VALID_INTENTS.includes(parsed.intent)) return fallback;
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
 * Trending rows as "Name (POS TEAM) — added 12,043x".
 *
 * The position is the point. Without it the model was handed ten bare names and
 * asked which of them were quarterbacks, and answered — correctly, uselessly —
 * that it could not tell.
 */
function formatTrendingRows(
    rows: TrendingPlayer[],
    playerIndex: Record<string, PlayerIdentity>,
    verb: string,
): string {
    if (!rows.length) return 'No trending data.';
    return rows.slice(0, 25)
        .map((p) => {
            const id = playerIndex[p.player_id];
            const who = id
                ? `${id.name} (${id.position}${id.team ? ` ${id.team}` : ''})`
                : p.player_id;
            return `  ${who} — ${verb} ${p.count.toLocaleString('en-US')}x`;
        })
        .join('\n');
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
    playerIndex: Record<string, PlayerIdentity>,
    plan: QueryPlan,
    dataContext: string,
    leagueCtx: LeagueContext | null,
    tools: AgentTools,
    missingLeague = false,
): string {
    const statsBlock = stats.length
        ? stats.map((p, i) => `${i + 1}. ${formatStatRow(p)}`).join('\n')
        : 'No stat data available for this query.';

    // Fifty names the reader did not ask about are fifty names of prompt. Only
    // the questions that are actually about waiver activity get them.
    const showTrending = TRENDING_INTENTS.includes(plan.intent);
    const trendingBlock = showTrending
        ? `--- TRENDING ADDS, LEAGUE-WIDE (last 24h) ---
${formatTrendingRows(trendingAdds, playerIndex, 'added')}

--- TRENDING DROPS, LEAGUE-WIDE (last 24h) ---
${formatTrendingRows(trendingDrops, playerIndex, 'dropped')}
`
        : '';

    const leagueBlock = leagueCtx ? formatLeagueContext(leagueCtx) : '';
    const toolBlock   = formatAgentTools(tools);
    const hasMyTeam   = tools.matchup !== null || tools.waivers !== null || tools.trades !== null;

    return `You are an expert fantasy football analyst talking to one manager about their own team.
Lead with the recommendation. Then support it with the numbers, and name them.
Keep it to a few short paragraphs or a short list — this is read on a phone.
Format with plain Markdown: **bold** for the names and verdicts that matter, "- " for lists. No tables, no headings.

HOW TO USE THE DATA:
${hasMyTeam
    ? 'The sections below marked "MY" are THIS manager\'s own team, pulled live from their league. "my running back", "should I start him", "who do I pick up", "who should I trade for" — all of it resolves against those sections. NEVER ask which player they mean when the position appears in MY STARTERS or MY BENCH; name the player yourself and answer. If the position appears more than once, cover each of them briefly.'
    : missingLeague
        ? 'No roster is connected for this manager, so answer the general question well rather than refusing it: give the best options in the data and say which situations each fits. Then, in ONE closing line, mention that picking their league from the league selector at the top of the page lets you answer for their actual roster.'
        : 'This question is about the NFL rather than about one roster. Answer it from the data below.'}
${showTrending ? 'The TRENDING lists are a popularity snapshot of what the whole fantasy world is adding and dropping — they are NOT a list of every player who is playing well, and a position missing from them means nothing. If you are asked which players at a position are trending up and that position is thin in the trending list, answer from NFL STATS instead, which is ranked for exactly this question.\n' : ''}Never reply that a position is absent from the data when a section below is about that position.
Do not invent players, stats or scores that are not below. If a specific number really is missing, say which one and answer with what is there.
The NFL STATS section is pre-ranked — do not reorder it. Player labels carry games played and per-game averages.
Projections carry a floor and a ceiling: the projection is the expectation, and the gap between floor and ceiling is the risk. Say which one matters for the call you are making.

--- DATA CONTEXT ---
${dataContext}
${toolBlock ? `\n${toolBlock}\n` : ''}
--- NFL STATS ---
${statsBlock}

${leagueBlock}${trendingBlock}`;
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
        case 'start_sit':
            return hasLeague
                ? `The manager's own week: both projected team totals, every starter and every bench player with a floor/ceiling band, plus ${plan.position ?? 'the position'}'s recent scoring leaders league-wide for comparison.`
                : `No roster connected — ${plan.position ?? 'skill position'} scoring leaders over the last ${plan.weeksBack ?? 3} weeks, as the general answer.`;
        case 'waiver_wire':
            return hasLeague
                ? `The manager's own positional needs, ranked against their league, and the best un-rostered players available to them.`
                : `No roster connected — recent form and league-wide add activity, as the general answer.`;
        case 'trade_analyzer':
            return hasLeague
                ? `Trade proposals built from every roster in the manager's league, with what each side's starting lineup gains.`
                : `No roster connected — recent form, as the general answer.`;
        case 'trending':
            return plan.position
                ? `${plan.position} players whose own scoring is rising, steepest first: the last ${plan.weeksBack ?? 2} weeks against the three before them. Use this list for "trending up" — the add/drop counts below are popularity, not form.`
                : `Most recent week top performers + Sleeper add/drop activity (last 24h).`;
        default:
            return `Most recent week top performers by fantasy points (PPR).`;
    }
}

// ── Model helpers ─────────────────────────────────────────────────────────────

/**
 * Which provider answers first.
 *
 * Gemini, because of what one of these prompts actually costs. A panel-backed
 * answer runs 5,000-9,000 tokens, and Groq's free tier allows 100,000 of them
 * a day on its largest model — roughly a dozen answers for the whole league,
 * against Gemini's few hundred. Groq stays as the fallback, and stays first for
 * Pass 1, where an 870-token classification is well inside every limit.
 *
 * Set AGENT_PRIMARY=groq to put it back in front — on a paid Groq plan it is
 * much the faster of the two, and then the ordering here is the only thing
 * standing in the way.
 */
function primaryProvider(): ModelUsed {
    return process.env.AGENT_PRIMARY?.trim().toLowerCase() === 'groq' ? 'groq' : 'gemini';
}

/**
 * Roughly how many tokens a string will cost.
 *
 * Measured against this route's own prompts, which are dense with decimals,
 * abbreviations and player names and tokenize at about 2.4 characters each —
 * far denser than the ~4 that English prose averages. Approximate by nature and
 * only ever used to decide whether an attempt is worth making.
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 2.4);
}

/**
 * Logs which block made a prompt large, when one is.
 *
 * A prompt over budget is a data question, not a model question — a deep-bench
 * league, a roster scan that legitimately reads every team, a stat query that
 * came back wider than expected — and the only way to tell which is to see the
 * sections measured separately. Cheap enough to run whenever it matters, which
 * is only on the requests that already exceeded the ceiling.
 */
function logOversizePrompt(prompt: string, tokens: number, budget: number, intent: QueryIntent): void {
    const MARKS = [
        'HOW TO USE THE DATA', '--- DATA CONTEXT ---', '--- MY MATCHUP', '--- MY WAIVER WIRE',
        '--- MY TRADE TARGETS', '--- PANEL DATA UNAVAILABLE', '--- NFL STATS ---',
        '--- LEAGUE CONTEXT', '--- TRENDING ADDS', '--- TRENDING DROPS',
    ];
    const found = MARKS
        .map((m) => [m, prompt.indexOf(m)] as const)
        .filter(([, i]) => i >= 0)
        .sort((a, b) => a[1] - b[1]);
    const sections = found.map(([mark, at], i) => {
        const endsAt = i + 1 < found.length ? found[i + 1][1] : prompt.length;
        return `${mark.replace(/^-+ ?| ?-+$/g, '')}=${estimateTokens(prompt.slice(at, endsAt))}`;
    });
    console.warn(
        `[pass-2] prompt ~${tokens} tokens over the ${budget} budget (intent=${intent}); `
        + `sections: ${sections.join(', ')}`,
    );
}

/**
 * The most tokens one Groq request may carry.
 *
 * Groq enforces tokens-per-minute per model, and its free tier sets that below
 * what a panel-backed prompt costs on every model except the largest: 8,000 on
 * the gpt-oss pair, 6,000 on llama-3.1-8b. A prompt over the ceiling does not
 * degrade, it 429s — and it does so *selectively*, answering questions about
 * the NFL and refusing the ones about the reader's own roster, which are the
 * questions the panels exist for. Better to skip an attempt that cannot succeed
 * and let the other provider have it.
 *
 * Set AGENT_GROQ_TPM to your plan's real figure; 0 disables the check.
 */
function groqTpmBudget(): number {
    const configured = Number(process.env.AGENT_GROQ_TPM);
    return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 12_000;
}

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

    const params = new URL(req.url).searchParams;

    // ?usage=1 — what this client has already spent from the current hour.
    //
    // Read-only: it reports the bucket without debiting it, which is what lets
    // the page open showing the real count. Before this existed the browser had
    // no way to ask, so every reload drew an empty meter over a window that was
    // already half spent.
    if (params.get('usage') === '1') {
        const { used, remaining, resetAt } = peekHourlyLimit(getClientId(req));
        const daily = checkDailyLimit();
        return NextResponse.json(
            {
                limit: HOURLY_LIMIT, used, remaining, resetAt,
                dailyLimit:   DAILY_LIMIT,
                dailyUsed:    daily.used,
                dailyResetAt: daily.resetAt,
            },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    }

    const groqReady   = getGroq()   !== null;
    const geminiReady = getGemini() !== null;

    if (params.get('live') !== '1') {
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

/**
 * Intents that read the TRENDING blocks — what the wider fantasy world is
 * adding and dropping.
 *
 * ~900 tokens for fifty names that, on a start/sit question, are fifty players
 * who are not on the roster being asked about. The prompt already has to warn
 * the model not to mistake this list for a form ranking; the cheaper fix is not
 * to show it where it cannot help.
 */
const TRENDING_INTENTS: QueryIntent[] = ['waiver_wire', 'trending', 'roster_scan', 'general'];

/**
 * Intents that read the LEAGUE CONTEXT block — every roster in the league, the
 * standings, and the NFL schedule ahead.
 *
 * Three, not the eight it was. That block is ~1,600 tokens and a pair of
 * Sleeper calls, and for a start/sit or a waiver question it is entirely
 * redundant: the matchup panel already carries the asker's roster and their
 * opponent's, with projections, and the other ten rosters have nothing to do
 * with which of two running backs to start. These three are the questions that
 * are actually *about* the other rosters.
 */
const LEAGUE_AWARE_INTENTS: QueryIntent[] = [
    'standings', 'roster_scan', 'playoff_schedule',
];

/**
 * Intents that are unanswerable without the asker's roster.
 *
 * Narrower than the list above, and the difference is the point: a trending
 * question reads better for knowing which of those names are free in the
 * asker's league, but it is a real question without one. Prodding someone to
 * connect a league they did not ask about is the kind of note that gets
 * ignored, and then ignored on the question where it mattered.
 */
const MY_TEAM_INTENTS: QueryIntent[] = [
    'start_sit', 'waiver_wire', 'trade_analyzer',
    'standings', 'roster_scan', 'playoff_schedule',
    'player_comparison',
];

/**
 * Which dashboard panels an intent needs.
 *
 * Each one is a Sleeper build behind two model calls, so nothing is fetched
 * speculatively. The overlaps are deliberate: a start/sit answer is better for
 * knowing there is a free agent who beats the player being benched, and a trade
 * answer is better for knowing which of my positions the league has me last in.
 */
function toolsFor(intent: QueryIntent): ToolRequest {
    switch (intent) {
        case 'start_sit':        return { matchup: true, waivers: true };
        case 'waiver_wire':      return { waivers: true, matchup: true };
        case 'trade_analyzer':   return { trades: true, waivers: true };
        case 'roster_scan':      return { trades: true, waivers: true };
        case 'playoff_schedule': return { matchup: true };
        case 'player_comparison':return { matchup: true };
        case 'trending':         return { waivers: true };
        default:                 return {};
    }
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
            {
                status: 429,
                headers: {
                    'X-RateLimit-Limit':     String(HOURLY_LIMIT),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset':     String(resetAt),
                    'X-Daily-Limit':         String(DAILY_LIMIT),
                    'X-Daily-Prompts-Used':  String(getDailyCount()),
                    'X-Daily-Reset':         String(dailyResetAt()),
                },
            },
        );
    }

    // The app's share of the provider's daily quota. Checked after the per-client
    // window and before any provider call, so the reader who runs the app out of
    // budget meets this message rather than a raw 429 from inside a stream.
    const daily = checkDailyLimit();
    if (!daily.allowed) {
        return NextResponse.json(
            {
                error: 'The assistant has reached its daily limit for everyone. It resets at midnight UTC.',
                resetAt: daily.resetAt,
            },
            {
                status: 429,
                headers: {
                    'X-RateLimit-Limit':     String(HOURLY_LIMIT),
                    'X-RateLimit-Remaining': String(remaining),
                    'X-RateLimit-Reset':     String(resetAt),
                    'X-Daily-Limit':         String(DAILY_LIMIT),
                    'X-Daily-Prompts-Used':  String(daily.used),
                    'X-Daily-Reset':         String(daily.resetAt),
                },
            },
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

    // The Sleeper account is read from the session, not the request body: the
    // panels below answer with one manager's roster, and which manager that is
    // is not the browser's to nominate.
    const sleeperUserId = session.user?.sleeperUserId ?? null;

    // Fetch all context in parallel — DB stats, Sleeper trending, player index,
    // and whichever of the three dashboard panels this question needs.
    const [stats, { adds: trendingAdds, drops: trendingDrops }, playerIndex, tools] = await Promise.all([
        executeQueryPlan(plan),
        fetchTrending(),
        fetchSleeperPlayerIndex(),
        fetchAgentTools(body.sleeperLeagueId, sleeperUserId, toolsFor(plan.intent)),
    ]);
    const playerMap: Record<string, string> = {};
    for (const [id, info] of Object.entries(playerIndex)) playerMap[id] = info.name;

    // Phase 2: fetch league context only if sleeperLeagueId provided and intent benefits from it
    const needsLeague = LEAGUE_AWARE_INTENTS.includes(plan.intent);
    const leagueCtx = (body.sleeperLeagueId && needsLeague)
        ? await fetchLeagueContext(body.sleeperLeagueId, playerMap, CURRENT_SEASON)
        : null;
    // If the question is about the asker's own team and there is nothing to
    // answer it from — no league selected, no Sleeper account connected, or
    // every panel failed — the model is told to answer generally and say so
    // once, rather than asking the user which of their players they meant.
    const hasMyTeam = tools.matchup !== null || tools.waivers !== null || tools.trades !== null;
    const missingLeague = MY_TEAM_INTENTS.includes(plan.intent) && !hasMyTeam && leagueCtx === null;

    const dataContext = buildDataContext(plan, hasMyTeam || leagueCtx !== null);
    const systemPrompt = buildSystemPrompt(
        stats, trendingAdds, trendingDrops, playerIndex, plan, dataContext, leagueCtx, tools, missingLeague,
    );

    incrementDaily();
    const dailyCount = getDailyCount();

    // Pass 2 — stream the answer.
    //
    // Both providers are tried in turn, primary first, and a failure of any
    // kind moves to the next one: a revoked key, a retired model ID, a rate
    // limit or an outage used to take the whole assistant down with a healthy
    // key for the other provider sitting right there.
    //
    // Which one leads is a quota decision rather than a quality one — see
    // primaryProvider().
    //
    // The size budget DEFERS Groq rather than vetoing it. Skipping a request
    // that will probably 429 is worth doing while another provider might still
    // answer; refusing to make it when nothing else can is not. The first
    // version of this got that backwards and turned a bad Gemini key into no
    // answer at all, with a Groq key sitting right there — a 429 that might not
    // even happen is strictly better than a certain failure.
    let answer: StreamResult | null = null;
    let modelUsed: ModelUsed = primaryProvider();
    let fallbackReason: string | null = null;
    const failures: string[] = [];

    const promptTokens = estimateTokens(systemPrompt);
    const tpmBudget = groqTpmBudget();
    const groqOverBudget = tpmBudget > 0 && promptTokens > tpmBudget;

    if (groqOverBudget) logOversizePrompt(systemPrompt, promptTokens, tpmBudget, plan.intent);

    const order: ModelUsed[] = primaryProvider() === 'groq' ? ['groq', 'gemini'] : ['gemini', 'groq'];

    /**
     * Runs one provider, recording why it failed.
     *
     * Returns the stream rather than assigning it, so the assignment happens at
     * the call site where TypeScript can still see it — a closure writing to
     * `answer` narrows it to `never` for every later read.
     */
    async function tryProvider(provider: ModelUsed): Promise<StreamResult | null> {
        try {
            const stream = provider === 'groq'
                ? await streamGroq(systemPrompt, messages)
                : await streamGemini(systemPrompt, messages);
            modelUsed = provider;
            return stream;
        } catch (providerErr) {
            const label = provider === 'groq' ? 'Groq' : 'Gemini';
            const message = providerErr instanceof Error ? providerErr.message : `${label} API error`;
            console.error(`[pass-2] ${provider} error:`, providerErr);
            failures.push(`${label}: ${message}`);
            if (!fallbackReason) {
                fallbackReason = provider === 'groq'
                    ? (isGroqRateLimitError(providerErr) ? 'groq_rate_limit' : 'groq_error')
                    : 'gemini_error';
            }
            return null;
        }
    }

    let deferredGroq = false;

    for (const provider of order) {
        const ready = provider === 'groq' ? groqReady : geminiReady;
        if (!ready) {
            if (!fallbackReason) fallbackReason = `${provider}_unavailable`;
            continue;
        }
        if (provider === 'groq' && groqOverBudget) {
            // Held back, not ruled out — see the loop below.
            deferredGroq = true;
            if (!fallbackReason) fallbackReason = 'groq_prompt_too_large';
            continue;
        }
        answer = await tryProvider(provider);
        if (answer) break;
    }

    // Nothing answered and Groq was only held back for its size. Make the call
    // anyway: the budget is a guess at somebody's rate limit, and the reader is
    // otherwise getting an error either way.
    if (!answer && deferredGroq) {
        console.warn('[pass-2] no provider answered — trying groq over budget rather than failing');
        answer = await tryProvider('groq');
    }

    if (!answer) {
        return err(failures.length
            ? `Every AI provider failed — ${failures.join('; ')}`
            : 'The AI service is unavailable — no provider is configured to answer.', 502);
    }
    // Nothing fell back if the provider that answered was the one asked first.
    if (modelUsed === primaryProvider()) fallbackReason = null;

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
        'X-Daily-Limit': String(DAILY_LIMIT),
        'X-Daily-Prompts-Used': String(dailyCount),
        'X-Daily-Reset': String(dailyResetAt()),
        'X-Query-Intent': plan.intent,
        // What this answer cost to ask. The one number that says whether a
        // deployment is anywhere near its provider's per-minute ceiling.
        'X-Prompt-Tokens': String(promptTokens),
        'X-League-Context': leagueCtx ? 'true' : 'false',
        'X-Panel-Data': [
            tools.matchup ? 'matchup' : '',
            tools.waivers ? 'waivers' : '',
            tools.trades  ? 'trades'  : '',
        ].filter(Boolean).join(',') || 'none',
    };
    if (fallbackReason) headers['X-Fallback-Reason'] = fallbackReason;

    return new Response(answer.stream, { headers });
}
