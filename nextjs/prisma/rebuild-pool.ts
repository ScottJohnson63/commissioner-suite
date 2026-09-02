// One-off runner for rebuildCardPool, so the pool can be rebuilt from the CLI
// rather than only through the commissioner UI. Same code path as
// POST /api/cards/pool.
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

async function main() {
  const { rebuildCardPool } = await import('../src/lib/cards/pool');
  const { prisma } = await import('../src/lib/prisma');

  const before = await prisma.cardDefinition.groupBy({ by: ['tier'], _count: true });
  const ownedBefore = await prisma.cardOwnership.count();
  console.log('before:', Object.fromEntries(before.map((r) => [r.tier, r._count])),
              '| owned rows:', ownedBefore);

  const result = await rebuildCardPool();
  console.log(`rebuilt ${result.total} cards across ${result.seasons.length} seasons`);

  const after = await prisma.cardDefinition.groupBy({ by: ['tier'], _count: true });
  const ownedAfter = await prisma.cardOwnership.count();
  const orphans = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*) AS n FROM CardOwnership o
     WHERE NOT EXISTS (SELECT 1 FROM CardDefinition c WHERE c.id = o.cardId)`;
  console.log('after :', Object.fromEntries(after.map((r) => [r.tier, r._count])),
              '| owned rows:', ownedAfter, '| orphaned ownerships:', Number(orphans[0].n));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
