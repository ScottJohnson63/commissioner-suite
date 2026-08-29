/**
 * prisma/apply-migration.ts
 *
 * Applies one migration directory's SQL to Turso. Prisma's own `migrate deploy`
 * cannot drive a libsql remote, so migrations are applied here instead.
 *
 *   npx tsx prisma/apply-migration.ts <migration-dir-name> [--dry-run]
 *
 * Before executing anything it verifies that every column each RedefineTables
 * step copies forward actually exists in the live database. A `db push` database
 * can drift from the migration history, and a mid-run failure would leave the
 * schema half-rebuilt with the original table already dropped.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

import { createClient } from '@libsql/client';

const migrationName = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!migrationName) {
  console.error('usage: tsx prisma/apply-migration.ts <migration-dir-name> [--dry-run]');
  process.exit(1);
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/** Splits on semicolons that end a line; this migration has none inside literals. */
function statementsOf(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

async function columnsOf(table: string): Promise<Set<string>> {
  const { rows } = await client.execute(`PRAGMA table_info("${table}")`);
  return new Set(rows.map((r) => String((r as Record<string, unknown>).name)));
}

async function tableNames(): Promise<string[]> {
  const { rows } = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  return rows.map((r) => String((r as Record<string, unknown>).name));
}

async function rowCount(table: string): Promise<number> {
  const { rows } = await client.execute(`SELECT COUNT(*) AS n FROM "${table}"`);
  return Number((rows[0] as Record<string, unknown>).n ?? 0);
}

/** Every `INSERT INTO "new_X" (...) SELECT ... FROM "X"` the migration performs. */
function copySteps(sql: string) {
  const re = /INSERT INTO "new_(\w+)" \(([^)]*)\) SELECT ([\s\S]*?) FROM "(\w+)"/g;
  const steps: { table: string; selected: string[] }[] = [];
  for (const m of sql.matchAll(re)) {
    steps.push({
      table: m[4],
      selected: m[3].split(',').map((c) => c.trim().replace(/^"|"$/g, '')),
    });
  }
  return steps;
}

async function main() {
  const dir = resolve(__dirname, 'migrations', migrationName);
  const sql = readFileSync(resolve(dir, 'migration.sql'), 'utf8');
  const statements = statementsOf(sql);

  console.log(`target:    ${process.env.TURSO_DATABASE_URL}`);
  console.log(`migration: ${migrationName} (${statements.length} statements)\n`);

  const existing = await tableNames();
  console.log(`tables before: ${existing.join(' ')}\n`);

  // Pre-flight: refuse to start if a copy step would reference a missing column.
  let blocked = false;
  for (const { table, selected } of copySteps(sql)) {
    if (!existing.includes(table)) {
      console.log(`  ${table}: table absent — copy step would fail`);
      blocked = true;
      continue;
    }
    const live = await columnsOf(table);
    const missing = selected.filter((c) => !live.has(c));
    const n = await rowCount(table);
    if (missing.length) {
      console.log(`  ${table}: ${n} rows, MISSING ${missing.join(', ')}`);
      blocked = true;
    } else {
      console.log(`  ${table}: ${n} rows, all ${selected.length} copied columns present`);
    }
  }

  if (blocked) {
    console.error('\n✗ Pre-flight failed. Nothing was executed.');
    process.exit(1);
  }
  console.log('\n✓ Pre-flight passed.');

  if (dryRun) {
    console.log('Dry run — stopping before execution.');
    return;
  }

  for (const [i, stmt] of statements.entries()) {
    try {
      await client.execute(stmt);
    } catch (e) {
      console.error(`\n✗ Statement ${i + 1}/${statements.length} failed:\n${stmt.slice(0, 300)}`);
      throw e;
    }
  }
  console.log(`✓ Applied ${statements.length} statements.\n`);

  console.log(`tables after: ${(await tableNames()).join(' ')}`);
  for (const { table } of copySteps(sql)) {
    console.log(`  ${table}: ${await rowCount(table)} rows, ${(await columnsOf(table)).size} columns`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => client.close());
