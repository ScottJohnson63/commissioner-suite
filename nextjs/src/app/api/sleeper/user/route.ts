// src/app/api/sleeper/user/route.ts
//
// Proxies Sleeper user + league lookups server-side so API calls
// don't originate from the browser. No auth required — Sleeper's
// user API is public.

import { NextRequest, NextResponse } from 'next/server';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const CURRENT_SEASON = parseInt(process.env.NFL_SEASON ?? String(new Date().getFullYear()), 10);

interface SleeperUser {
    user_id: string;
    username: string;
    display_name: string;
    avatar: string | null;
}

interface SleeperLeagueRaw {
    league_id: string;
    name: string;
    season: string;
    total_rosters: number;
    status: string; // 'in_season' | 'pre_draft' | 'drafting' | 'complete'
    settings: {
        playoff_week_start?: number;
    };
}

interface SleeperLeague {
    leagueId: string;
    name: string;
    season: number;
    totalRosters: number;
    status: string;
    playoffWeekStart: number;
}

async function sleeperGet<T>(path: string): Promise<T> {
    const res = await fetch(`${SLEEPER_BASE}${path}`, {
        next: { revalidate: 300 }, // cache 5 min — league list doesn't change often
    });
    if (!res.ok) throw new Error(`Sleeper API ${res.status} for ${path}`);
    return res.json() as Promise<T>;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    const { searchParams } = req.nextUrl;
    const username = searchParams.get('username')?.trim().toLowerCase();
    const userId = searchParams.get('userId')?.trim();

    if (!username && !userId) {
        return NextResponse.json({ error: 'username or userId is required' }, { status: 400 });
    }

    try {
        // Step 1 — resolve to user object.
        // Prefer userId (stable) over username (can change) per Sleeper docs.
        const user = await sleeperGet<SleeperUser>(userId ? `/user/${userId}` : `/user/${username}`);

        if (!user?.user_id) {
            return NextResponse.json({ error: 'Sleeper user not found' }, { status: 404 });
        }

        // Step 2 — fetch their leagues for the current season
        const leaguesRaw = await sleeperGet<SleeperLeagueRaw[]>(
            `/user/${user.user_id}/leagues/nfl/${CURRENT_SEASON}`,
        );

        const leagues: SleeperLeague[] = (leaguesRaw ?? []).map((l) => ({
            leagueId: l.league_id,
            name: l.name,
            season: Number(l.season),
            totalRosters: l.total_rosters,
            status: l.status,
            playoffWeekStart: l.settings?.playoff_week_start ?? 15,
        }));

        return NextResponse.json({
            userId: user.user_id,
            username: user.username,
            displayName: user.display_name,
            avatar: user.avatar,
            leagues,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch Sleeper data';
        const status = message.includes('404') ? 404 : 502;
        return NextResponse.json({ error: message }, { status });
    }
}