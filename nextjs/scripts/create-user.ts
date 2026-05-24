/**
 * Creates a local user with username/password credentials.
 * Usage: npx tsx scripts/create-user.ts <username> <password> <role>
 *   role: COMMISSIONER | MEMBER (default: MEMBER)
 *
 * Example:
 *   npx tsx scripts/create-user.ts scott mypassword COMMISSIONER
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const [,, username, password, role = 'MEMBER'] = process.argv;

if (!username || !password) {
  console.error('Usage: npx tsx scripts/create-user.ts <username> <password> [COMMISSIONER|MEMBER]');
  process.exit(1);
}

if (role !== 'COMMISSIONER' && role !== 'MEMBER') {
  console.error('Role must be COMMISSIONER or MEMBER');
  process.exit(1);
}

const adapter = new PrismaLibSql({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { username },
    update: { password: hashed, role: role as 'COMMISSIONER' | 'MEMBER' },
    create: { username, password: hashed, role: role as 'COMMISSIONER' | 'MEMBER', name: username },
  });
  console.log(`✓ User "${user.username}" created with role ${user.role}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
