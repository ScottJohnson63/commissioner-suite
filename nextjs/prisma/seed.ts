import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env before importing Prisma so TURSO_* vars are available
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import bcrypt from 'bcryptjs';

/**
 * The commissioner password has no default: a fallback baked into this file
 * would be a published credential, since the repo is public. Refuse to seed
 * rather than create an account everyone can sign in to.
 */
function requireAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (password) return password;

  console.error('');
  console.error('✗ ADMIN_PASSWORD is not set.');
  console.error('');
  console.error('  Seeding will not create a commissioner with a default password.');
  console.error('  Set ADMIN_PASSWORD to a strong, unique value and re-run, e.g.:');
  console.error('');
  console.error('    ADMIN_PASSWORD=\'<your-password>\' npm run seed');
  console.error('');
  process.exit(1);
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = requireAdminPassword();
const ADMIN_NAME     = process.env.ADMIN_NAME     ?? 'Admin';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL     ?? 'admin@commissioner-suite.local';

const adapter = new PrismaLibSql({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const existing = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });

  if (existing) {
    await prisma.user.update({
      where: { username: ADMIN_USERNAME },
      data: { role: 'COMMISSIONER' },
    });
    console.log(`✓ Admin user "${ADMIN_USERNAME}" already exists — role set to COMMISSIONER.`);
    return;
  }

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  await prisma.user.create({
    data: {
      username: ADMIN_USERNAME,
      email:    ADMIN_EMAIL,
      name:     ADMIN_NAME,
      password: hash,
      role:     'COMMISSIONER',
    },
  });

  console.log('');
  console.log('✓ Admin commissioner created');
  console.log('  Username :', ADMIN_USERNAME);
  console.log('  Password : (the value of ADMIN_PASSWORD)');
  console.log('  Email    :', ADMIN_EMAIL);
  console.log('');
  console.log('  → Sign-in re-checks Sleeper league membership for every account,');
  console.log('    commissioners included. This username must resolve to a Sleeper');
  console.log('    user who belongs to a league registered in the database, or the');
  console.log('    login will be rejected.');
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
