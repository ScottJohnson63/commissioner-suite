// src/lib/league.ts
//
// Resolving "which league is this?" from whatever ID the caller had to hand.
//
// The app has two IDs for every league: the internal cuid on the League row and
// the Sleeper league ID. Client code passes whichever it holds — the dashboard
// carries the Sleeper ID, links built from a League row carry the cuid — so
// every league-scoped route accepts either. That `OR` clause was written out in
// six routes before this module existed.

import { prisma } from '@/lib/prisma';

/**
 * A `where` clause matching a league by either of its IDs.
 *
 * Use this when the caller needs its own `select`/`include`, so the shape of the
 * lookup stays shared while the projection stays local:
 *
 * ```ts
 * prisma.league.findFirst({ where: leagueWhere(id), include: { teams: true } })
 * ```
 */
export function leagueWhere(id: string) {
  return { OR: [{ id }, { sleeperLeagueId: id }] };
}

/**
 * Finds a league by internal ID or Sleeper league ID.
 *
 * Returns null when nothing matches — callers decide whether that is a 404 or
 * something they can recover from.
 */
export async function findLeagueByAnyId(id: string) {
  return prisma.league.findFirst({ where: leagueWhere(id) });
}

/**
 * Finds a league by either ID, returning only its internal `id`.
 *
 * The common case for routes that just need something to hang an audit entry or
 * a foreign key off, and would otherwise pull every column to use one.
 */
export async function findLeagueIdByAnyId(id: string): Promise<string | null> {
  const league = await prisma.league.findFirst({
    where: leagueWhere(id),
    select: { id: true },
  });
  return league?.id ?? null;
}
