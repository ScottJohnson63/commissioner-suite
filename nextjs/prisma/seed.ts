import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env before importing Prisma so TURSO_* vars are available
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import bcrypt from 'bcryptjs';

const adapter = new PrismaLibSql({
  url:       process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const prisma = new PrismaClient({ adapter });

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Commissioner1!';
const ADMIN_NAME     = process.env.ADMIN_NAME     ?? 'Admin';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL     ?? 'admin@commissioner-suite.local';

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
  console.log('  Password :', ADMIN_PASSWORD);
  console.log('  Email    :', ADMIN_EMAIL);
  console.log('');
  console.log('  → The Sleeper username field is bypassed for commissioners — enter anything.');
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
