import { config } from 'dotenv';
config({ path: '.env' }); config({ path: '.env.local', override: true });
import { prisma } from '@/lib/prisma';
import { openOnePack, readAllowance } from '@/lib/cards/service';
import { PACKS_PER_WEEK, GUARANTEED_GOLD_PACKS } from '@/lib/cards/allowance';
const U='__t_gold__', S=2097;
const clean = async (w:number) => { for (const t of [prisma.packGrant, prisma.packOpening] as any[])
  await t.deleteMany({ where: { userId: U } }); await prisma.cardOwnership.deleteMany({ where: { gameSeason: S } }); };
(async () => {
  console.log(`ration ${PACKS_PER_WEEK}/week, ${GUARANTEED_GOLD_PACKS} guaranteed Gold+\n`);
  let weeks = 0, ok = 0; const dist: Record<string,number> = {}; const goldCounts: number[] = [];
  for (let w = 1; w <= 25; w++) {
    await clean(w);
    const a = await readAllowance(U, S, w);
    const tiers: string[] = [];
    for (let i = 0; i < a.granted; i++) {
      const r = await openOnePack(U, S, w);
      if (!r.ok) break;
      tiers.push(r.result.packTier);
      dist[r.result.packTier] = (dist[r.result.packTier] ?? 0) + 1;
    }
    const gold = tiers.filter(t => t === 'GOLD' || t === 'HALL_OF_FAME').length;
    goldCounts.push(gold);
    weeks++; if (gold >= GUARANTEED_GOLD_PACKS) ok++;
    if (w <= 6) console.log(`  week ${w}: ${tiers.join(', ')}  → ${gold} gold+`);
    if (tiers.length !== PACKS_PER_WEEK) console.log(`  !! week ${w} dealt ${tiers.length} packs`);
  }
  console.log(`\nweeks meeting the guarantee: ${ok}/${weeks}`);
  console.log('gold+ per week distribution:', JSON.stringify(goldCounts.reduce((m:any,n)=>{m[n]=(m[n]??0)+1;return m;},{})));
  console.log('pack tier distribution over', weeks*PACKS_PER_WEEK, 'packs:', JSON.stringify(dist));
  await clean(0); console.log('cleaned up');
})();
