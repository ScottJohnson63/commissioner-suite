/**
 * prisma/reset-card-game.ts
 *
 * Clears everything members own in the card game, so the season starts over.
 *
 * Deletes CardOwnership, PackGrant and PackOpening — which releases every
 * claimed card back into the pool and hands everyone a fresh weekly ration with
 * their wildcard die still to throw.
 *
 * Deliberately does NOT touch CardDefinition. The pool is derived from NFL
 * history and does not expire; rebuilding it is a separate job
 * (POST /api/cards/pool, or the button on /league/cards).
 *
 * The commissioner UI on /league/cards does the same thing for one season and
 * is the normal route. This exists for development, where there is no session
 * to authenticate with.
 *
 *   npx tsx prisma/reset-card-game.ts            # every season
 *   npx tsx prisma/reset-card-game.ts 2026       # just one
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

import { createClient } from '@libsql/client';

const client = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/**
 * Tables holding what members own, in the order they are cleared.
 *
 * Keep in sync with OWNED_TABLES in src/app/api/cards/reset/route.ts, which
 * does the same job through Prisma for the commissioner button. RosterSlot,
 * StarterGrant and PackBonus were missing from both: a reset wiped every card a
 * member owned and left their lineup standing, still scoring in the standings.
 */
const OWNED_TABLES = [
  'CardOwnership', 'PackGrant', 'PackOpening', 'WildcardCard',
  'RosterSlot', 'StarterGrant', 'PackBonus',
  // Vanity pictures — a member's own image over a card that already had a face.
  'CardImage',
  // The weekly game, children before parents — see the note in the reset route.
  'LineupCard', 'LineupSubmission',
] as const;

// ⚠️ CardPortrait is deliberately absent, and must stay absent.
//
// A contributed portrait is the only face a card with no photograph anywhere
// will ever have. It belongs to the card rather than to a season's ownership,
// so it survives every reset and next season's owner inherits it. It has no
// `gameSeason` column, so the `WHERE` this script builds could not scope to it
// even if it were listed — which is the point.
//
// See CardPortrait in prisma/schema.prisma.

async function main() {
  const arg = process.argv[2];
  const season = arg ? Number(arg) : null;

  if (arg && !Number.isInteger(season)) {
    throw new Error(`Season must be a year, got: ${arg}`);
  }

  const scope = season === null ? 'every season' : `season ${season}`;
  const where = season === null ? '' : ` WHERE "gameSeason" = ${season}`;

  console.log(`Resetting the card game for ${scope}…\n`);

  for (const table of OWNED_TABLES) {
    const { rows } = await client.execute(`SELECT COUNT(*) AS n FROM "${table}"${where}`);
    const before = Number((rows[0] as Record<string, unknown>).n ?? 0);

    await client.execute(`DELETE FROM "${table}"${where}`);
    console.log(`  ✓ ${table.padEnd(14)} cleared ${before} row(s)`);
  }

  // The pool is what makes a reset survivable — confirm it is still there.
  const pool = await client.execute(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT season) AS seasons FROM "CardDefinition"`,
  );
  const { n, seasons } = pool.rows[0] as Record<string, unknown>;

  console.log(`\n✓ Reset complete. Card pool untouched: ${n} cards across ${seasons} season(s).`);
  console.log('  Everyone starts with an empty deck, 10 packs and an unthrown wildcard.');
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
