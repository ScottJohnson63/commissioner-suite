// src/app/api/cards/reset/route.ts
//
// POST — the end-of-season reset. Commissioner only.
//
// Wipes every trace of one game season, so the next starts everybody at zero.
// The card pool is deliberately left alone: the cards themselves are derived
// from NFL history and do not expire, and rebuilding them is a separate button.
//
// Contributed portraits survive too — see the note under OWNED_TABLES.
//
// "Everything" is enumerated in OWNED_TABLES rather than written out at each
// call site. It was a hand-maintained list in three places and had drifted:
// lineups were never cleared, so a reset wiped every card a member owned and
// left their starting lineup standing — nine slots pointing at cards nobody
// held any more. The standings rank on lineup points, so the scoreboard also
// survived the reset that was supposed to clear it.
//
// This is destructive and cannot be undone, so it will not run on a guess: the
// season to clear must be named explicitly in the body, and it must match a
// season that actually has rows. A bare POST is refused rather than defaulting
// to the current season, which is the one a mis-click would hurt most.

import { NextRequest, NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireCommissioner } from '@/lib/apiAuth';
import { writeAuditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

/**
 * The shape a season-scoped table has to expose to be resettable.
 *
 * Structural rather than a Prisma union: every one of these models is keyed by
 * gameSeason and nothing else here needs to know what else they hold.
 */
interface SeasonScoped {
  count(args: { where: { gameSeason: number } }): Promise<number>;
  deleteMany(args: { where: { gameSeason: number } }): Promise<{ count: number }>;
}

/**
 * Every table a reset clears, keyed by the name it is reported under.
 *
 * Add a season-scoped model here and it is counted, deleted and audited with no
 * other change. Anything scoped by gameSeason belongs in this list — leaving a
 * model out does not make the reset gentler, it makes it inconsistent, which is
 * how the roster bug happened.
 *
 * Keep in sync with OWNED_TABLES in prisma/reset-card-game.ts, which does the
 * same job over raw SQL for the command-line reset.
 */
const OWNED_TABLES: Record<string, SeasonScoped> = {
  ownerships: prisma.cardOwnership,
  grants:     prisma.packGrant,
  openings:   prisma.packOpening,
  wildcards:  prisma.wildcardCard,
  // The lineup. Cleared with the cards it points at — a slot holding a card its
  // owner no longer has is not a lineup, and it still scores in the standings.
  rosters:    prisma.rosterSlot,
  // The one-off welcome packs. A member starting from nothing again should get
  // the same leg up a new member gets.
  starters:   prisma.starterGrant,
  // Sleeper bonus awards. Left behind, the unique key on (user, season, week,
  // kind) would permanently block re-earning a bonus for a week already played.
  bonuses:    prisma.packBonus,
  // Vanity pictures — a member's own image on a card that already had a face.
  // Season-scoped decoration, cleared with the ownership it decorated.
  images:     prisma.cardImage,
  // The weekly game. Cards first, then the submissions they hang off: the
  // relation cascades, but SQLite only honours a foreign key when
  // `PRAGMA foreign_keys` is on and nothing here guarantees the adapter sets
  // it. An orphaned LineupCard would go on retiring a card for a season that
  // no longer exists — which is exactly the shape of the bug that put
  // RosterSlot on this list.
  lineupCards: prisma.lineupCard,
  lineups:     prisma.lineupSubmission,
};

// ⚠️ CardPortrait is deliberately absent, and must stay absent.
//
// A contributed portrait is a picture for a card that had no photograph
// anywhere — the only face that card will ever have. It belongs to the card
// rather than to a season's ownership, so it outlives the reset and next
// season's owner inherits it. It has no `gameSeason` column at all, which is
// what makes adding it here impossible rather than merely wrong.
//
// See CardPortrait in prisma/schema.prisma.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = await requireCommissioner();
  if (denied) return denied;

  let body: { season?: unknown };
  try {
    body = await req.json();
  } catch {
    return err('Body must be JSON: { "season": 2026 }', 400);
  }

  const season = Number(body?.season);
  if (!Number.isInteger(season) || season < 1999 || season > 2100) {
    return err('A "season" year is required, e.g. { "season": 2026 }', 400);
  }

  try {
    const where = { gameSeason: season };
    const names = Object.keys(OWNED_TABLES);

    // Counted before the delete so the audit entry records what was actually
    // destroyed rather than a zero from re-reading an emptied table.
    const counts = Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [name, await OWNED_TABLES[name].count({ where })] as const),
      ),
    ) as Record<string, number>;

    const total = Object.values(counts).reduce((n, c) => n + c, 0);
    if (total === 0) {
      return err(`Nothing to reset — no card-game activity for ${season}`, 404);
    }

    await Promise.all(names.map((name) => OWNED_TABLES[name].deleteMany({ where })));

    await writeAuditLog('DELETE', null, {
      operation: 'card-season-reset',
      season, ...counts,
    });

    return ok({ season, ...counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reset season';
    return err(message, 500);
  }
}
