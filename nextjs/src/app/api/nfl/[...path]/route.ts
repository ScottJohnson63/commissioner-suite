// src/app/api/nfl/[...path]/route.ts
//
// Internal NFL statistics API — reads the local NflWeeklyStat table, which the
// nflverse sync jobs in python/scripts populate on a fixed schedule.
//
// Supported endpoints (path segment after /api/nfl/):
//
//   leaders — GET /api/nfl/leaders?season=&stat=&position=&limit=
//               Aggregates season totals for a given stat column and returns
//               the top N players by that stat. Drives the Statistics tab
//               leaderboards. Only columns in ALLOWED_STAT_COLS may be queried
//               (SQL injection prevention — the column name is interpolated
//               directly into a raw query because Prisma does not support
//               dynamic aggregate columns).
//
// Reads the Turso DB only; no external API calls happen on the request path.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api';
// The allowlist lives with the stat catalog so the API and the Statistics
// dropdown can never disagree about which columns exist.
import { ALLOWED_STAT_COLS } from '@/lib/nflStats';


interface StatLeaderRow {
  playerId: string;
  playerDisplayName: string | null;
  position: string | null;
  team: string | null;
  headshot: string | null;
  statValue: number;
  gamesPlayed: number;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  const { searchParams } = req.nextUrl;
  const endpoint = path[0];

  try {
    switch (endpoint) {
      // ── Seasons that actually have rows ────────────────────────────────────
      // GET /api/nfl/seasons  →  [2025, 2024, 2023]
      //
      // Drives the Statistics tab's season picker. Reading this from the table
      // rather than from NFL_SEASON matters: NFL_SEASON is the *current* season
      // for Sleeper's sake, and in the months before kickoff no stats exist for
      // it yet — defaulting to it would render an empty leaderboard.
      case 'seasons': {
        const rows = await prisma.$queryRaw<{ season: number }[]>`
          SELECT DISTINCT season FROM NflWeeklyStat ORDER BY season DESC
        `;
        return ok(rows.map((r) => Number(r.season)));
      }

      // ── Season stat leaders (aggregated totals) ─────────────────────────────
      // GET /api/nfl/leaders?stat=passingYards&position=QB&limit=25[&season=2025]
      case 'leaders': {
        // Omitting `season` means "the newest one with data", so the page keeps
        // working across a rollover without a redeploy.
        const requested = searchParams.get('season');
        const latest = requested
          ? null
          : await prisma.$queryRaw<{ season: number }[]>`
              SELECT MAX(season) AS season FROM NflWeeklyStat
            `;
        const season = requested
          ? Number(requested)
          : Number(latest?.[0]?.season ?? new Date().getFullYear());
        const rawStat = searchParams.get('stat') ?? 'fantasyPointsPpr';
        const pos     = searchParams.get('position')?.toUpperCase() ?? '';
        const limit   = Math.min(Number(searchParams.get('limit') ?? '25'), 100);

        if (!ALLOWED_STAT_COLS.has(rawStat)) {
          return err(`Invalid stat column: ${rawStat}`, 400);
        }

        // Position is always a short all-caps abbreviation — safe to inline
        // after stripping non-alpha chars.
        const safePosClause = pos && /^[A-Z]{1,3}$/.test(pos)
          ? `AND position = '${pos}'`
          : '';

        // $queryRawUnsafe is appropriate here: stat column is whitelist-validated,
        // position is regex-stripped, season/limit are parameterised.
        const rows = await prisma.$queryRawUnsafe<StatLeaderRow[]>(
          `SELECT
             playerId,
             MAX(playerDisplayName) AS playerDisplayName,
             MAX(position)          AS position,
             MAX(team)              AS team,
             MAX(headshot)          AS headshot,
             SUM(${rawStat})        AS statValue,
             COUNT(*)               AS gamesPlayed
           FROM NflWeeklyStat
           WHERE season = ?
             AND ${rawStat} IS NOT NULL
             ${safePosClause}
           GROUP BY playerId
           HAVING SUM(${rawStat}) > 0
           ORDER BY SUM(${rawStat}) DESC
           LIMIT ?`,
          season,
          limit,
        );

        // Turso may return bigint for COUNT(*) — normalise
        const normalised = rows.map((r) => ({
          ...r,
          statValue:   typeof r.statValue   === 'bigint' ? Number(r.statValue)   : r.statValue,
          gamesPlayed: typeof r.gamesPlayed === 'bigint' ? Number(r.gamesPlayed) : r.gamesPlayed,
        }));

        return ok(normalised);
      }

      default:
        return err(`Unknown endpoint: ${endpoint}`, 404);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database error';
    return err(message);
  }
}