/**
 * prisma/migrate-turso.ts
 *
 * Applies the username NOT NULL + drop sleeperUsername migration to Turso.
 * SQLite can't ALTER COLUMN, so we recreate the User table.
 *
 * Run once after `npm run cleanup`:
 *   npm run migrate:turso
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

async function main() {
  // 1. Verify no null usernames remain
  const { rows } = await client.execute(
    `SELECT COUNT(*) AS n FROM "User" WHERE username IS NULL`,
  );
  const nullCount = Number((rows[0] as Record<string, unknown>).n ?? 0);
  if (nullCount > 0) {
    console.error(`✗ ${nullCount} user(s) still have NULL username. Run 'npm run cleanup' first.`);
    process.exit(1);
  }

  console.log('✓ No null usernames — proceeding with migration...');

  // 2. Recreate User table without sleeperUsername and with username NOT NULL
  await client.batch([
    // Create replacement table
    `CREATE TABLE IF NOT EXISTS "_User_new" (
      "id"            TEXT    NOT NULL PRIMARY KEY,
      "name"          TEXT,
      "username"      TEXT    NOT NULL UNIQUE,
      "email"         TEXT    UNIQUE,
      "emailVerified" DATETIME,
      "image"         TEXT,
      "password"      TEXT,
      "role"          TEXT    NOT NULL DEFAULT 'MEMBER',
      "sleeperUserId" TEXT,
      "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    // Copy all rows (sleeperUsername is dropped)
    `INSERT INTO "_User_new"
       ("id","name","username","email","emailVerified","image","password","role","sleeperUserId","createdAt","updatedAt")
     SELECT
       "id","name","username","email","emailVerified","image","password","role","sleeperUserId","createdAt","updatedAt"
     FROM "User"`,

    // Swap tables
    `DROP TABLE "User"`,
    `ALTER TABLE "_User_new" RENAME TO "User"`,
  ], 'write');

  console.log('✓ User table migrated — sleeperUsername dropped, username is now NOT NULL.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => client.close());
