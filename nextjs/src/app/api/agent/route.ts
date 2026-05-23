// src/app/api/agent/route.ts

import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '@/lib/prisma';

// ── Clients ───────────────────────────────────────────────────────────────────

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const CURRENT_SEASON = 2024;

// ── Rate limiting (in-memory, server-scoped) ──────────────────────────────────

/**
 * Tracks per-IP hourly prompt counts and a global daily total across all IPs.
 * Resets automatically when the relevant time window rolls over.
 *
 * NOTE: This is process-local. In a multi-instance deployment you would move
 * this to Redis / KV. For a single-instance Vercel/Railway deploy it is fine.
 */
interface HourBucket {
    count: number;
    windowStart: number; // epoch ms when this hour window started
}

interface DayBucket {
    count: number;
    dayKey: string; // e.g. "2025-01-15"
}

const hourlyBuckets = new Map<string, HourBucket>();
let dailyBucket: DayBucket = { count: 0, dayKey: '' };

const HOURLY_LIMIT = 5;

function todayKey(): string {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Returns the current daily usage count, resetting the bucket if the calendar
 * day has changed.
 */
function getDailyCount(): number {
    const key = todayKey();
    if (dailyBucket.dayKey !== key) {
        dailyBucket = { count: 0, dayKey: key };
    }
    return dailyBucket.count;
}

function incrementDaily(): void {
    const key = todayKey();
    if (dailyBucket.dayKey !== key) {
        dailyBucket = { count: 0, dayKey: key };
    }
    dailyBucket.count += 1;
}

/**
 * Checks whether the given IP has exceeded the hourly limit.
 * Returns `{ allowed: boolean; remaining: number; resetAt: number }`.
 */
function checkHourlyLimit(ip: string): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
} {
    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    let bucket = hourlyBuckets.get(ip);

    if (!bucket || now - bucket.windowStart >= ONE_HOUR_MS) {
        bucket = { count: 0, windowStart: now };
        hourlyBuckets.set(ip, bucket);
    }

    const remaining = Math.max(0, HOURLY_LIMIT - bucket.count);
    const resetAt = bucket.windowStart + ONE_HOUR_MS;

    if (bucket.count >= HOURLY_LIMIT) {
        return { allowed: false, remaining: 0, resetAt };
    }

    bucket.count += 1;
    hourlyBuckets.set(ip, bucket);
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
    player_id: string;
    player_name?: string;
    position?: string;
    recent_team?: string;
    passing_yards?: number;
    passing_tds?: number;
    interceptions?: number;
    rushing_yards?: number;
    rushing_tds?: number;
    receiving_yards?: number;
    receiving_tds?: number;
    receptions?: number;
    week?: number;
    season?: number;
}

interface TrendingPlayer {
    player_id: string;
    count: number;
    type: 'add' | 'drop';
}

interface AgentContext {
    nflStats: PlayerStats[];
    trendingAdds: TrendingPlayer[];
    trendingDrops: TrendingPlayer[];
}

type ModelUsed = 'gemini' | 'groq';

// ── Sleeper cache & rate-limiting ────────────────────────────────────────────
//
// All Sleeper fetches go through sleeperFetch(), which enforces a per-endpoint
// minimum interval (SLEEPER_MIN_INTERVAL_MS). If a request arrives before the
// interval has elapsed the cached value is returned immediately — no outbound
// request is made. This prevents the agent from hammering Sleeper even when
// many users submit prompts concurrently.
//
// TTLs:
//   Trending  — 10 minutes  (data changes slowly; trending is aggregate 24h)
//   Player map — 24 hours   (roster/name data is effectively static day-to-day)

const SLEEPER_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes between upstream calls

interface SleeperCacheEntry<T> {
    data: T;
    fetchedAt: number;
}

// Typed per-endpoint cache map
const sleeperCache = new Map<string, SleeperCacheEntry<unknown>>();
// Tracks when we last actually hit Sleeper for each URL key
const sleeperLastFetch = new Map<string, number>();

/**
 * Fetch from Sleeper with in-memory caching and server-side rate limiting.
 *
 * - If a fresh cached value exists (within ttlMs) it is returned immediately.
 * - If the cache is stale but SLEEPER_MIN_INTERVAL_MS has not elapsed since
 *   the last real fetch, the stale value is returned rather than hitting
 *   Sleeper again (fail-open: better to serve slightly stale data than get
 *   rate-blocked).
 * - Otherwise a real fetch is made and the cache is updated.
 */
async function sleeperFetch<T>(
    url: string,
    ttlMs: number,
    fetchOptions?: RequestInit,
): Promise<T | null> {
    const now = Date.now();
    const cached = sleeperCache.get(url) as SleeperCacheEntry<T> | undefined;
    const lastFetch = sleeperLastFetch.get(url) ?? 0;

    // Fresh cache — no network call needed
    if (cached && now - cached.fetchedAt < ttlMs) {
        return cached.data;
    }

    // Stale but rate-limit window not elapsed — serve stale rather than hit Sleeper
    if (cached && now - lastFetch < SLEEPER_MIN_INTERVAL_MS) {
        console.warn(`[sleeper] rate-limit guard: serving stale cache for ${url}`);
        return cached.data;
    }

    try {
        sleeperLastFetch.set(url, now);
        const res = await fetch(url, {
            ...fetchOptions,
            next: { revalidate: Math.floor(ttlMs / 1000) }, // also seed Next.js fetch cache
        });

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

// ── Data fetchers ─────────────────────────────────────────────────────────────

const TRENDING_TTL_MS    = 10 * 60 * 1000;  // 10 minutes
const PLAYER_MAP_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours

async function fetchRecentStats(): Promise<PlayerStats[]> {
    try {
        const stats = await prisma.nflWeeklyStat.findMany({
            where: { season: CURRENT_SEASON },
            orderBy: [{ week: 'desc' }, { fantasyPointsPpr: 'desc' }],
            take: 20,
        });
        return stats as unknown as PlayerStats[];
    } catch {
        return [];
    }
}

async function fetchTrending(): Promise<{ adds: TrendingPlayer[]; drops: TrendingPlayer[] }> {
    const [adds, drops] = await Promise.all([
        sleeperFetch<TrendingPlayer[]>(
            `${SLEEPER_BASE}/players/nfl/trending/add?lookback_hours=24&limit=20`,
            TRENDING_TTL_MS,
        ),
        sleeperFetch<TrendingPlayer[]>(
            `${SLEEPER_BASE}/players/nfl/trending/drop?lookback_hours=24&limit=20`,
            TRENDING_TTL_MS,
        ),
    ]);

    return {
        adds: (adds ?? []).map((p) => ({ ...p, type: 'add' as const })),
        drops: (drops ?? []).map((p) => ({ ...p, type: 'drop' as const })),
    };
}

// ── Player map — L1: in-memory  |  L2: Turso/Prisma  |  L3: Sleeper API ────────

const PLAYER_MAP_CACHE_KEY = 'nfl_player_map';

// L1 in-memory cache (survives within a single server instance lifetime)
let playerMapMemory: Record<string, string> | null = null;
let playerMapMemoryAt = 0;

async function fetchSleeperPlayerMap(): Promise<Record<string, string>> {
    const now = Date.now();

    // L1 — in-memory, still fresh
    if (playerMapMemory && now - playerMapMemoryAt < PLAYER_MAP_TTL_MS) {
        return playerMapMemory;
    }

    // L2 — Turso/Prisma persisted cache (survives cold starts)
    try {
        const row = await prisma.sleeperCache.findUnique({
            where: { key: PLAYER_MAP_CACHE_KEY },
        });

        if (row) {
            const ageMs = now - row.fetchedAt.getTime();
            if (ageMs < PLAYER_MAP_TTL_MS) {
                // DB record is still fresh — hydrate L1 and return
                const parsed = JSON.parse(row.data) as Record<string, string>;
                playerMapMemory = parsed;
                playerMapMemoryAt = row.fetchedAt.getTime();
                return parsed;
            }
        }
    } catch (dbErr) {
        console.error('[player-map] DB read error, falling through to Sleeper:', dbErr);
    }

    // L3 — Sleeper API (respects the shared rate-limit guard in sleeperFetch)
    type RawPlayer = { full_name?: string };

    const raw = await sleeperFetch<Record<string, RawPlayer>>(
        'https://api.sleeper.app/v1/players/nfl',
        PLAYER_MAP_TTL_MS,
    );

    if (!raw) {
        // Sleeper unreachable — return whatever we have (stale L1 or empty)
        return playerMapMemory ?? {};
    }

    const mapped = Object.fromEntries(
        Object.entries(raw)
            .filter(([, player]) => player.full_name)
            .map(([id, player]) => [id, player.full_name!]),
    );

    // Persist to Turso (upsert so first run creates, subsequent runs update)
    try {
        await prisma.sleeperCache.upsert({
            where: { key: PLAYER_MAP_CACHE_KEY },
            update: { data: JSON.stringify(mapped), fetchedAt: new Date() },
            create: { key: PLAYER_MAP_CACHE_KEY, data: JSON.stringify(mapped) },
        });
    } catch (dbErr) {
        // Non-fatal — we still have the fresh data, just couldn't persist it
        console.error('[player-map] DB write error:', dbErr);
    }

    // Update L1
    playerMapMemory = mapped;
    playerMapMemoryAt = now;

    return mapped;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildSystemPrompt(context: AgentContext, playerMap: Record<string, string>): string {
    const statsSnippet = context.nflStats
        .slice(0, 20)
        .map((p) =>
            [
                `Player: ${p.player_name ?? p.player_id}`,
                p.position ? `Position: ${p.position}` : null,
                p.recent_team ? `Team: ${p.recent_team}` : null,
                p.week ? `Week: ${p.week}` : null,
                p.passing_yards != null ? `Pass Yds: ${p.passing_yards}` : null,
                p.passing_tds != null ? `Pass TDs: ${p.passing_tds}` : null,
                p.interceptions != null ? `INTs: ${p.interceptions}` : null,
                p.rushing_yards != null ? `Rush Yds: ${p.rushing_yards}` : null,
                p.rushing_tds != null ? `Rush TDs: ${p.rushing_tds}` : null,
                p.receiving_yards != null ? `Rec Yds: ${p.receiving_yards}` : null,
                p.receiving_tds != null ? `Rec TDs: ${p.receiving_tds}` : null,
                p.receptions != null ? `Receptions: ${p.receptions}` : null,
            ]
                .filter(Boolean)
                .join(', '),
        )
        .join('\n');

    const trendingAddsSnippet = context.trendingAdds
        .slice(0, 10)
        .map((p) => {
            const name = playerMap[p.player_id] ?? `Player ID ${p.player_id}`;
            return `${name} (added ${p.count} times)`;
        })
        .join(', ');

    const trendingDropsSnippet = context.trendingDrops
        .slice(0, 10)
        .map((p) => {
            const name = playerMap[p.player_id] ?? `Player ID ${p.player_id}`;
            return `${name} (dropped ${p.count} times)`;
        })
        .join(', ');

    return `You are an expert fantasy football analyst. Answer the user's question using the data provided below.
Be concise, direct, and give a clear recommendation. Back your answer with specific stats when relevant.
If the data doesn't contain enough information to answer confidently, say so.

--- RECENT NFL STATS (${CURRENT_SEASON} season) ---
${statsSnippet || 'No stats available.'}

--- TRENDING ADDS (last 24h) ---
${trendingAddsSnippet || 'No trending data available.'}

--- TRENDING DROPS (last 24h) ---
${trendingDropsSnippet || 'No trending data available.'}
`;
}

// ── Model helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if an error looks like a Gemini rate-limit / quota error.
 * The Google Generative AI SDK throws plain Error objects; we inspect the
 * message and a possible `status` property added by the SDK.
 */
function isGeminiRateLimitError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    // SDK surfaces 429 as "quota exceeded" or includes the HTTP status
    return (
        msg.includes('429') ||
        msg.includes('quota') ||
        msg.includes('resource_exhausted') ||
        msg.includes('rate limit')
    );
}

/**
 * Attempt to stream a response from Gemini 2.5 Flash.
 * Resolves with a ReadableStream of text chunks on success,
 * throws on failure (including rate-limit).
 */
async function streamGemini(
    systemPrompt: string,
    messages: { role: string; content: string }[],
): Promise<ReadableStream<Uint8Array>> {
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: systemPrompt,
    });

    // Gemini uses 'user' / 'model' role names
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
            } catch (err) {
                controller.error(err);
            } finally {
                controller.close();
            }
        },
    });
}

/**
 * Stream a response from Groq llama-3.1-8b-instant.
 */
async function streamGroq(
    systemPrompt: string,
    messages: { role: string; content: string }[],
): Promise<ReadableStream<Uint8Array>> {
    const stream = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 1024,
    });

    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                for await (const chunk of stream) {
                    const text = chunk.choices[0]?.delta?.content ?? '';
                    if (text) controller.enqueue(encoder.encode(text));
                }
            } catch (err) {
                controller.error(err);
            } finally {
                controller.close();
            }
        },
    });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
    const body = (await req.json()) as { messages?: { role: string; content: string }[] };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    // ── Rate limiting ────────────────────────────────────────────────────────
    const clientId = getClientId(req);
    const { allowed, remaining, resetAt } = checkHourlyLimit(clientId);

    if (!allowed) {
        return NextResponse.json(
            {
                error: 'Hourly prompt limit reached. Please wait before sending more prompts.',
                resetAt,
            },
            {
                status: 429,
                headers: {
                    'X-RateLimit-Limit': String(HOURLY_LIMIT),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(resetAt),
                },
            },
        );
    }

    // ── Env guard ────────────────────────────────────────────────────────────
    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
        return NextResponse.json({ error: 'No AI API keys are configured' }, { status: 500 });
    }

    // ── Shared context ───────────────────────────────────────────────────────
    const [nflStats, { adds: trendingAdds, drops: trendingDrops }, playerMap] = await Promise.all([
        fetchRecentStats(),
        fetchTrending(),
        fetchSleeperPlayerMap(),
    ]);

    const systemPrompt = buildSystemPrompt({ nflStats, trendingAdds, trendingDrops }, playerMap);

    // ── Daily usage counter (after rate-limit gate so refused requests don't count) ──
    incrementDaily();
    const dailyCount = getDailyCount();

    // ── Try Gemini → fall back to Groq ───────────────────────────────────────
    let readable: ReadableStream<Uint8Array>;
    let modelUsed: ModelUsed = 'gemini';
    let fallbackReason: string | null = null;

    try {
        if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
        readable = await streamGemini(systemPrompt, body.messages);
    } catch (geminiErr) {
        const isRateLimit = isGeminiRateLimitError(geminiErr);
        fallbackReason = isRateLimit ? 'gemini_rate_limit' : 'gemini_error';

        if (!process.env.GROQ_API_KEY) {
            const message =
                geminiErr instanceof Error ? geminiErr.message : 'Gemini API error';
            return NextResponse.json({ error: message }, { status: 502 });
        }

        try {
            readable = await streamGroq(systemPrompt, body.messages);
            modelUsed = 'groq';
        } catch (groqErr) {
            const message = groqErr instanceof Error ? groqErr.message : 'Groq API error';
            return NextResponse.json({ error: message }, { status: 502 });
        }
    }

    // ── Stream response ───────────────────────────────────────────────────────
    const headers: Record<string, string> = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
        'X-Model-Used': modelUsed,
        'X-RateLimit-Limit': String(HOURLY_LIMIT),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(resetAt),
        'X-Daily-Prompts-Used': String(dailyCount),
    };

    if (fallbackReason) {
        headers['X-Fallback-Reason'] = fallbackReason;
    }

    return new Response(readable, { headers });
}