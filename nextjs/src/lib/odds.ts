// src/lib/odds.ts — The Odds API helpers for matchup-report enrichment.
// Requires ODDS_API_KEY env var; silently returns null when absent.

import { RouteCache } from '@/lib/cache';
import type { VegasLine } from '@/types/projections';

const oddsCache = new RouteCache<VegasLine[]>();

const ENRICHMENT_TTL = 60 * 60 * 1000; // 1 hour

export async function getNflOdds(week: number): Promise<VegasLine[] | null> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;

  const cacheKey = `nfl-odds-${week}`;
  const hit = oddsCache.get(cacheKey, ENRICHMENT_TTL);
  if (hit) return hit;

  try {
    const url =
      `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/` +
      `?apiKey=${apiKey}&regions=us&markets=totals,spreads&bookmakers=draftkings`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;

    const games = await res.json() as Array<{
      home_team:  string;
      away_team:  string;
      bookmakers: Array<{
        markets: Array<{
          key:      string;
          outcomes: Array<{ name: string; price: number; point?: number }>;
        }>;
      }>;
    }>;

    const lines: VegasLine[] = games.map((g) => {
      const bk     = g.bookmakers[0];
      const totals  = bk?.markets.find((m) => m.key === 'totals');
      const spreads = bk?.markets.find((m) => m.key === 'spreads');
      const total   = totals?.outcomes[0]?.point                              ?? 0;
      const spread  = spreads?.outcomes.find((o) => o.name === g.home_team)?.point ?? 0;
      return { homeTeam: g.home_team, awayTeam: g.away_team, total, spread };
    });

    oddsCache.set(cacheKey, lines);
    return lines;
  } catch {
    return null;
  }
}
