/**
 * prisma/apply-customization.ts
 *
 * Applies the card-customization migrations to Turso.
 *
 * Same pattern as apply-card-game.ts: the repo keeps migrations as SQL for the
 * record but has no `prisma migrate deploy` against Turso.
 *
 * Safe to re-run. SQLite has no ADD COLUMN IF NOT EXISTS, so a column that is
 * already there comes back as "duplicate column name" and is treated as done.
 *
 *   npx tsx prisma/apply-customization.ts
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
  for (const name of [
    '20260901000000_card_customization',
    '20260901120000_card_image_table',
    '20260901140000_card_portrait',
  ]) await apply(name);
}

/** Runs one migration's SQL, statement by statement, tolerating a re-run. */
async function apply(name: string): Promise<void> {
  console.log(name);
  const file = resolve(__dirname, `migrations/${name}/migration.sql`);
  // Comment lines are stripped first. Splitting on ';' and then dropping
  // chunks that *start* with '--' silently eats the first statement, because
  // the file's header comment is part of that chunk.
  const statements = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sql of statements) {
    try {
      await client.execute(sql);
      console.log('  ok  ', sql.slice(0, 70));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // SQLite has no ADD/DROP COLUMN IF [NOT] EXISTS, so a re-run reports a
      // column as duplicate or as missing. Both mean "already in the target
      // state", which is what makes this safe to run twice.
      if (/duplicate column name|no such column|cannot drop column/i.test(message)) {
        console.log('  skip', sql.slice(0, 70), '(already applied)');
        continue;
      }
      throw e;
    }
  }
}

main()
  .then(() => { console.log('✓ customization schema present'); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
