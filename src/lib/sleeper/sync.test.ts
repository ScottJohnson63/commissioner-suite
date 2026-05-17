// src/lib/sleeper/sync.test.ts
import 'dotenv/config';

import { fetchLeagueData } from './sync';
import { generateSchedule } from '@/lib/scheduler/engine';

async function main(): Promise<void> {
  const leagues = process.env.SLEEPER_LEAGUES?.split(',').map((id) => id.trim());

  if (leagues){
    for (var leagueId of leagues){
        if (!leagueId) {
            throw new Error('Set SLEEPER_LEAGUE_ID in your .env file');
        }

        console.log(`Fetching league ${leagueId}...\n`);

        const { leagueId: id, season, teams } = await fetchLeagueData(leagueId);

        console.log(`League ID : ${id}`);
        console.log(`Season    : ${season}`);
        console.log(`Teams     : ${teams.length}\n`);

        const div1 = teams.filter((t) => t.divisionId === 0);
        const div2 = teams.filter((t) => t.divisionId === 1);

        console.log(`Division 1 (${div1.length} teams):`);
        div1.forEach((t) => console.log(`  [${t.id}] ${t.name}`));

        console.log(`\nDivision 2 (${div2.length} teams):`);
        div2.forEach((t) => console.log(`  [${t.id}] ${t.name}`));

        if (teams.length !== 10) {
            console.warn(`\n⚠ Expected 10 teams, got ${teams.length}`);
            return;
        }
        if (div1.length !== 5 || div2.length !== 5) {
            console.warn(`\n⚠ Expected 5 teams per division — got ${div1.length} and ${div2.length}`);
            return;
        }

        console.log('\n✓ League data valid — generating schedule...\n');

        // --- Schedule engine test ---
        const schedule = generateSchedule(id, season, teams);

        console.log(`Generated ${schedule.weeks.length} weeks\n`);

        schedule.weeks.forEach((w) => {
            console.log(`Week ${String(w.week).padStart(2, ' ')}:`);
            w.matchups.forEach((m) => {
            const home = teams.find((t) => t.id === m.home)?.name ?? m.home;
            const away = teams.find((t) => t.id === m.away)?.name ?? m.away;
            const type = m.type === 'cross-division' ? '[cross]' : '[div]  ';
            console.log(`  ${type} ${home} vs ${away}`);
            });
        });

        // Verify no consecutive repeats in output
        let consecutiveFound = false;
        for (let i = 0; i < schedule.weeks.length - 1; i++) {
            const thisWeek = schedule.weeks[i];
            const nextWeek = schedule.weeks[i + 1];
            for (const m of thisWeek.matchups) {
            const repeat = nextWeek.matchups.some(
                (n) =>
                (n.home === m.home && n.away === m.away) ||
                (n.home === m.away && n.away === m.home),
            );
            if (repeat) {
                console.warn(`\n⚠ Consecutive repeat found: ${m.home} vs ${m.away} in weeks ${i + 1} and ${i + 2}`);
                consecutiveFound = true;
            }
            }
        }

        if (!consecutiveFound) {
            console.log('\n✓ No consecutive repeat matchups');
        }
    }
  }

  console.log('\n✓ End-to-end test passed — ready to wire up the API');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});