// src/app/api/agent/route.ts

import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PYTHON_API_URL = process.env.PYTHON_API_URL ?? 'http://localhost:8000';
const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const CURRENT_SEASON = 2024;

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

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchRecentStats(): Promise<PlayerStats[]> {
    try {
        const res = await fetch(
            `${PYTHON_API_URL}/nfl/weekly?season=${CURRENT_SEASON}`,
            { cache: 'no-store' },
        );
        if (!res.ok) return [];
        return res.json() as Promise<PlayerStats[]>;
    } catch {
        return [];
    }
}

async function fetchTrending(): Promise<{ adds: TrendingPlayer[]; drops: TrendingPlayer[] }> {
    try {
        const [addsRes, dropsRes] = await Promise.all([
            fetch(`${SLEEPER_BASE}/players/nfl/trending/add?lookback_hours=24&limit=20`),
            fetch(`${SLEEPER_BASE}/players/nfl/trending/drop?lookback_hours=24&limit=20`),
        ]);

        const adds = addsRes.ok
            ? ((await addsRes.json()) as TrendingPlayer[]).map((p) => ({ ...p, type: 'add' as const }))
            : [];
        const drops = dropsRes.ok
            ? ((await dropsRes.json()) as TrendingPlayer[]).map((p) => ({ ...p, type: 'drop' as const }))
            : [];

        return { adds, drops };
    } catch {
        return { adds: [], drops: [] };
    }
}

async function fetchSleeperPlayerMap(): Promise<Record<string, string>> {
    try {
        const res = await fetch('https://api.sleeper.app/v1/players/nfl', {
            next: { revalidate: 86400 }, // cache for 24 hours — this is a huge payload
        });
        if (!res.ok) return {};
        const data = await res.json() as Record<string, { full_name?: string }>;
        return Object.fromEntries(
            Object.entries(data)
                .filter(([, player]) => player.full_name)
                .map(([id, player]) => [id, player.full_name!]),
        );
    } catch {
        return {};
    }
}

function buildSystemPrompt(context: AgentContext, playerMap: Record<string, string>): string {
    const statsSnippet = context.nflStats
        .slice(0, 100) // keep prompt size reasonable
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

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
    const body = await req.json() as { messages?: { role: string; content: string }[] };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    if (!process.env.GROQ_API_KEY) {
        return NextResponse.json({ error: 'GROQ_API_KEY is not configured' }, { status: 500 });
    }

    const [nflStats, { adds: trendingAdds, drops: trendingDrops }, playerMap] = await Promise.all([
        fetchRecentStats(),
        fetchTrending(),
        fetchSleeperPlayerMap(),
    ]);

    // Add this temporarily:
    console.log('playerMap sample:', Object.entries(playerMap).slice(0, 3));
    console.log('first trending id:', trendingAdds[0]?.player_id);
    console.log('first trending name lookup:', playerMap[trendingAdds[0]?.player_id]);

    const systemPrompt = buildSystemPrompt({ nflStats, trendingAdds, trendingDrops }, playerMap);

    try {
        const stream = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                ...body.messages.map((m) => ({
                    role: m.role as 'user' | 'assistant',
                    content: m.content,
                })),
            ],
            stream: true,
            temperature: 0.3, // lower = more consistent fantasy advice
            max_tokens: 1024,
        });

        // Stream the response back to the client
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of stream) {
                        const text = chunk.choices[0]?.delta?.content ?? '';
                        if (text) {
                            controller.enqueue(encoder.encode(text));
                        }
                    }
                } catch (err) {
                    controller.error(err);
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(readable, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Transfer-Encoding': 'chunked',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Groq API error';
        return NextResponse.json({ error: message }, { status: 502 });
    }
}