// src/app/api/sleeper/user/route.ts
//
// Proxies Sleeper user + league lookups server-side so API calls
// don't originate from the browser. No auth required — Sleeper's
// user API is public.

import { NextRequest, NextResponse } from 'next/server';
import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import type { SleeperUser, SleeperLeagueRaw } from '@/lib/sleeper/types';
import { ok, err } from '@/lib/api';

const CURRENT_SEASON = parseInt(process.env.NFL_SEASON ?? String(new Date().getFullYear()), 10);

interface SleeperLeague {
    leagueId: string;
    name: string;
    season: number;
    totalRosters: number;
    status: string;
    playoffWeekStart: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    const { searchParams } = req.nextUrl;
    const username = searchParams.get('username')?.trim().toLowerCase();
    const userId = searchParams.get('userId')?.trim();

    if (!username && !userId) {
        return err('username or userId is required', 400);
    }

    try {
        // Step 1 — resolve to user object.
        // Prefer userId (stable) over username (can change) per Sleeper docs.
        // A longer TTL than the league data below: nobody renames themselves and
        // then checks this app to see whether it took, and every signed-in user
        // re-reads this on each dashboard load. See SLEEPER_TTL.USER.
        const user = await sleeperGet<SleeperUser>(
            userId ? `/user/${userId}` : `/user/${username}`,
            SLEEPER_TTL.USER,
        );

        if (!user?.user_id) {
            return err('Sleeper user not found', 404);
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

        return ok({
            userId: user.user_id,
            username: user.username,
            displayName: user.display_name,
            avatar: user.avatar,
            leagues,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch Sleeper data';
        const status = message.includes('404') ? 404 : 502;
        return err(message, status);
    }
}
