/**
 * prisma/apply-card-game.ts
 *
 * Applies migrations/20260829000000_add_card_game to Turso.
 *
 * The repo keeps migrations as SQL for the record but has no `prisma migrate
 * deploy` step against Turso, so schema changes are pushed with a small script
 * like this one (see migrate-turso.ts for the precedent).
 *
 * Additive only — four CREATE TABLEs and their indexes. Nothing existing is
 * read, altered or dropped, and every statement is IF NOT EXISTS, so running it
 * twice is a no-op.
 *
 *   npx tsx prisma/apply-card-game.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';

const client = createClient({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  // Applied in order. Both are safe to re-run: the first is all IF NOT EXISTS
  // (see the rewrite below), and the second no-ops once `count` is gone.
  const MIGRATIONS = [
    '20260829000000_add_card_game',
    '20260829120000_exclusive_card_ownership',
    '20260829140000_pack_wildcard',
    '20260829160000_card_ppg_jersey_nextpack',
    '20260829180000_roster_slots',
    '20260830000000_sleeper_bonus_packs',
    '20260830120000_pack_opening_is_bonus',
    '20260830140000_starter_packs',
    '20260830160000_wildcard_card',
  ];

  for (const name of MIGRATIONS) await apply(name);
}

/** Runs one migration's SQL, statement by statement. */
async function apply(name: string): Promise<void> {
  const sql = readFileSync(
    resolve(__dirname, `migrations/${name}/migration.sql`),
    'utf8',
  );

  // Split on statement boundaries and drop comment-only fragments.
  const statements = sql
    // Comments are stripped BEFORE splitting, not after. The other order breaks
    // on a semicolon inside a comment: the split lands mid-sentence and the
    // tail of the prose is handed to the database as SQL.
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    // Idempotent, so a partial previous run can be finished by re-running.
    .map((s) =>
      s
        .replace(/^CREATE TABLE "/, 'CREATE TABLE IF NOT EXISTS "')
        .replace(/^CREATE (UNIQUE )?INDEX "/, 'CREATE $1INDEX IF NOT EXISTS "'),
    );

  // The ownership rebuild is only meaningful once. Detect the finished shape
  // and skip, rather than dropping a table that already holds live claims.
  if (name.endsWith('exclusive_card_ownership') && (await isExclusiveAlready())) {
    console.log(`· ${name} — already applied, skipping`);
    return;
  }
  // ADD COLUMN is not idempotent in SQLite, so check before repeating it.
  if (name.endsWith('pack_wildcard') && (await hasColumn('PackGrant', 'wildcardRoll'))) {
    console.log(`· ${name} — already applied, skipping`);
    return;
  }
  if (name.endsWith('ppg_jersey_nextpack') && (await hasColumn('CardDefinition', 'pointsPerGame'))) {
    console.log(`· ${name} — already applied, skipping`);
    return;
  }
  if (name.endsWith('sleeper_bonus_packs') && (await hasColumn('PackGrant', 'bonusGranted'))) {
    console.log(`· ${name} — already applied, skipping`);
    return;
  }
  if (name.endsWith('starter_packs') && (await hasColumn('PackOpening', 'kind'))) {
    console.log(`· ${name} — already applied, skipping`);
    return;
  }
  if (name.endsWith('pack_opening_is_bonus') && (await hasColumn('PackOpening', 'isBonus'))) {
    console.log(`· ${name} — already applied, skipping`);
    return;
  }
  // DROP COLUMN is not idempotent either, and this one runs after the migration
  // that adds the column back. On a replay `pack_wildcard` re-adds wildcardRoll
  // — its own guard sees it missing — and this then drops it again, which is
  // wasteful but lands on the right shape. Skip only when the column really is
  // already gone.
  if (
    name.endsWith('wildcard_card') &&
    !(await hasColumn('PackGrant', 'wildcardRoll'))
  ) {
    console.log(`· ${name} — already applied, skipping`);
    return;
  }

  console.log(`\n${name}`);
  for (const statement of statements) {
    await client.execute(statement);
    console.log('  ✓', statement.split('\n')[0].slice(0, 70));
  }
}

/** True when `table` already has `column`. */
async function hasColumn(table: string, column: string): Promise<boolean> {
  const { rows } = await client.execute(`PRAGMA table_info("${table}")`);
  return rows.some((r) => (r as Record<string, unknown>).name === column);
}

/** True once CardOwnership has been rebuilt without its `count` column. */
async function isExclusiveAlready(): Promise<boolean> {
  const { rows } = await client.execute(`PRAGMA table_info("CardOwnership")`);
  if (!rows.length) return false;
  return !rows.some((r) => (r as Record<string, unknown>).name === 'count');
}

async function verify(): Promise<void> {
  const { rows } = await client.execute(
    `SELECT name FROM sqlite_master
      WHERE type='table'
        AND name IN ('CardDefinition','PackGrant','CardOwnership','PackOpening')
      ORDER BY name`,
  );
  console.log(`\n✓ ${rows.length}/4 card-game tables present:`,
    rows.map((r) => r.name).join(', '));

  const owned = await client.execute('SELECT COUNT(*) AS n FROM "CardOwnership"');
  console.log(`✓ ${(owned.rows[0] as Record<string, unknown>).n} card(s) claimed`);
}

main().then(verify).catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
