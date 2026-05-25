/**
 * prisma/cleanup.ts
 *
 * Deletes every User whose username is NULL so the schema can be pushed
 * with username as NOT NULL. Those users will need to re-register via OAuth
 * and reconnect their Sleeper account.
 *
 * Run BEFORE `npx prisma db push`:
 *   npm run cleanup
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const adapter = new PrismaLibSql({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const nullUsers = await prisma.user.findMany({
    where:  { username: { equals: null as unknown as string } },
    select: { id: true, email: true, name: true },
  });

  if (nullUsers.length === 0) {
    console.log('✓ No users with null username found — nothing to clean up.');
    return;
  }

  console.log(`Found ${nullUsers.length} user(s) with null username:`);
  nullUsers.forEach((u) =>
    console.log(`  · ${u.name ?? u.email ?? u.id}`),
  );

  // Cascade manually (SQLite doesn't always enforce FK cascade on delete)
  const ids = nullUsers.map((u) => u.id);
  await prisma.account.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  console.log(`\n✓ Deleted ${nullUsers.length} user(s) and their linked accounts/sessions.`);
  console.log('  These users will need to sign in again via OAuth and reconnect Sleeper.\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
