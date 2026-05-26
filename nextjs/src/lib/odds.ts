// src/lib/odds.ts — The Odds API helpers for matchup-report enrichment.
// Requires ODDS_API_KEY env var; silently returns null when absent.

import { RouteCache } from '@/lib/cache';
import type { VegasLine } from '@/types/projections';

const oddsCache = new RouteCache<VegasLine[]>();

const ENRICHMENT_TTL = 60 * 60 * 1000; // 1 hour

// In-season sport preference order for demo / live mode
export const SPORT_PRIORITY = [
  'basketball_nba',
  'icehockey_nhl',
  'baseball_mlb',
  'soccer_usa_mls',
  'americanfootball_nfl',
] as const;

const DEMO_ODDS_CACHE_KEY = 'demo-live-odds';

/** Fetches odds for the first currently-active sport we can find. Used in DEMO_MODE. */
export async function getLiveOdds(apiKey: string): Promise<VegasLine[] | null> {
  const hit = oddsCache.get(DEMO_ODDS_CACHE_KEY, ENRICHMENT_TTL);
  if (hit) return hit;

  // Step 1 — find active sports (free endpoint, no quota cost)
  const sportsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`,
    { next: { revalidate: 3600 } },
  );
  if (!sportsRes.ok) return null;

  const sports = await sportsRes.json() as Array<{
    key:    string;
    title:  string;
    active: boolean;
  }>;

  let chosen: { key: string; title: string } | undefined;
  for (const key of SPORT_PRIORITY) {
    const s = sports.find((sp) => sp.key === key && sp.active);
    if (s) { chosen = s; break; }
  }
  if (!chosen) chosen = sports.find((s) => s.active);
  if (!chosen) return null;

  // Step 2 — fetch odds for chosen sport
  const oddsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/${chosen.key}/odds/` +
    `?apiKey=${apiKey}&regions=us&markets=totals,spreads&bookmakers=draftkings`,
    { next: { revalidate: 3600 } },
  );
  if (!oddsRes.ok) return null;

  const games = await oddsRes.json() as Array<{
    home_team:  string;
    away_team:  string;
    bookmakers: Array<{
      markets: Array<{
        key:      string;
        outcomes: Array<{ name: string; price: number; point?: number }>;
      }>;
    }>;
  }>;

  // Shorten team names to last word for display (e.g. "Boston Celtics" → "Celtics")
  const sportLabel = chosen.title.replace(/^.*?_/, '').toUpperCase();

  const lines: VegasLine[] = games.slice(0, 6).map((g) => {
    const bk     = g.bookmakers[0];
    const totals  = bk?.markets.find((m) => m.key === 'totals');
    const spreads = bk?.markets.find((m) => m.key === 'spreads');
    const total   = totals?.outcomes[0]?.point                              ?? 0;
    const spread  = spreads?.outcomes.find((o) => o.name === g.home_team)?.point ?? 0;
    return { homeTeam: g.home_team, awayTeam: g.away_team, total, spread, sport: sportLabel };
  });

  const result = lines.length > 0 ? lines : null;
  if (result) oddsCache.set(DEMO_ODDS_CACHE_KEY, result);
  return result;
}

/** Fetches current NFL game odds (production mode). */
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
