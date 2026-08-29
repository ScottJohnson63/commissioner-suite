/**
 * Unlinks Sleeper accounts so the connect-sleeper flow has to be walked again.
 *
 *   npx tsx prisma/clear-sleeper-link.ts            # every user
 *   npx tsx prisma/clear-sleeper-link.ts bhanboi    # one username
 *
 * Prints the previous values first, so restoring is a single UPDATE if this
 * turns out to be the wrong call. Existing sessions carry sleeperUserId in the
 * JWT, so sign out and back in for the change to take effect in the browser.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const username = process.argv[2];

async function main() {
  const before = await client.execute(
    `SELECT "username","role","sleeperUserId" FROM "User" ORDER BY "username"`,
  );
  console.log('Before:');
  console.table(before.rows);

  const result = username
    ? await client.execute({
        sql: `UPDATE "User" SET "sleeperUserId" = NULL WHERE "username" = ?`,
        args: [username],
      })
    : await client.execute(
        `UPDATE "User" SET "sleeperUserId" = NULL WHERE "sleeperUserId" IS NOT NULL`,
      );

  console.log(`\nCleared ${result.rowsAffected} row(s)${username ? ` for "${username}"` : ''}.\n`);

  const after = await client.execute(
    `SELECT "username","role","sleeperUserId" FROM "User" ORDER BY "username"`,
  );
  console.log('After:');
  console.table(after.rows);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => client.close());
