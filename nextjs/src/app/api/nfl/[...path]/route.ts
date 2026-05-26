// src/app/api/nfl/[...path]/route.ts
//
// Internal NFL statistics API — proxies queries against the local NflWeeklyStat
// database table populated by nfl_data_py (see the Python FastAPI service).
//
// Supported endpoints (path segment after /api/nfl/):
//
//   weekly  — GET /api/nfl/weekly?season=&week=&position=&limit=
//               Returns raw per-player weekly stat rows, ordered by week desc
//               then fantasy points desc. Useful for game-log displays.
//
//   players — GET /api/nfl/players?season=&position=
//               Returns the distinct set of players who have stats in a given
//               season, ordered alphabetically. Used to populate player pickers.
//
//   leaders — GET /api/nfl/leaders?season=&stat=&position=&limit=
//               Aggregates season totals for a given stat column and returns
//               the top N players by that stat. Designed for the Statistics tab
//               leaderboards. Only columns in ALLOWED_STAT_COLS may be queried
//               (SQL injection prevention — the column name is interpolated
//               directly into a raw query because Prisma does not support
//               dynamic aggregate columns).
//
// All endpoints read from the local Turso DB; no external API calls are made.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api';

// Allowlist of stat columns for the /leaders endpoint.
// The column name is interpolated directly into raw SQL ($queryRawUnsafe),
// so it must be validated against this set before use — never trust user input.
const ALLOWED_STAT_COLS = new Set([
  // Fantasy
  'fantasyPointsPpr', 'fantasyPoints',
  // Passing
  'passingYards', 'passingTds', 'passingInterceptions', 'completions', 'attempts',
  'passingAirYards', 'passingYardsAfterCatch', 'passingFirstDowns', 'sacksSuffered',
  'passingEpa', 'passingCpoe', 'pacr',
  // Rushing
  'rushingYards', 'rushingTds', 'carries', 'rushingFirstDowns', 'rushingEpa',
  // Receiving
  'receivingYards', 'receivingTds', 'receptions', 'targets',
  'receivingAirYards', 'receivingYardsAfterCatch', 'receivingFirstDowns', 'receivingEpa',
  'targetShare', 'airYardsShare', 'wopr', 'racr',
  // Defense
  'defTacklesSolo', 'defTacklesForLoss', 'defSacks', 'defQbHits',
  'defInterceptions', 'defPassDefended', 'defFumblesForced', 'defTds',
  // Kicking
  'fgMade', 'fgAtt', 'patMade',
]);

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
      case 'weekly': {
        const season = Number(searchParams.get('season') ?? '2025');
        const week = searchParams.get('week')
          ? Number(searchParams.get('week'))
          : undefined;
        const position = searchParams.get('position') ?? undefined;
        const limit = searchParams.get('limit')
          ? Math.min(Number(searchParams.get('limit')), 200)
          : undefined;

        const stats = await prisma.nflWeeklyStat.findMany({
          where: {
            season,
            ...(week !== undefined && { week }),
            ...(position !== undefined && { position }),
          },
          orderBy: [{ week: 'desc' }, { fantasyPointsPpr: 'desc' }],
          ...(limit !== undefined && { take: limit }),
        });

        return ok(stats);
      }

      case 'players': {
        const season = Number(searchParams.get('season') ?? '2025');
        const position = searchParams.get('position') ?? undefined;

        const players = await prisma.nflWeeklyStat.findMany({
          where: {
            season,
            ...(position !== undefined && { position }),
          },
          distinct: ['playerId'],
          select: {
            playerId: true,
            playerName: true,
            playerDisplayName: true,
            position: true,
            positionGroup: true,
            team: true,
            headshot: true,
          },
          orderBy: { playerDisplayName: 'asc' },
        });

        return ok(players);
      }

      // ── Season stat leaders (aggregated totals) ─────────────────────────────
      // GET /api/nfl/leaders?season=2025&stat=passingYards&position=QB&limit=25
      case 'leaders': {
        const season  = Number(searchParams.get('season') ?? '2025');
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