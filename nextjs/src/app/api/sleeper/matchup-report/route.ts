// src/app/api/sleeper/matchup-report/route.ts
//
// Projects floor/ceiling for both sides of the user's current-week matchup.
// Enriches with:
//   • Defensive strength  (from local NflWeeklyStat DB)
//   • Weather forecasts   (Open-Meteo — free, no key)
//   • Vegas/live odds     (The Odds API — needs ODDS_API_KEY env var)
//
// GET /api/sleeper/matchup-report?leagueId=&userId=&season=&week=
//
// ── DEMO_MODE ─────────────────────────────────────────────────────────────────
// Set DEMO_MODE=true in .env to bypass the Sleeper matchup endpoint entirely.
// The route loads two dummy rosters from src/mock_data/matchup.json, picks a
// random regular-season week from NFL_SEASON, calls the real weather API for
// outdoor stadiums, and fetches live odds from whatever sport is currently
// in-season (NBA, MLB, NHL … — not limited to NFL).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPlayerMap, type SleeperPlayerInfo } from '@/lib/sleeper/playerCache';
import MOCK_MATCHUP from '@/mock_data/matchup.json';

const BASE    = 'https://api.sleeper.app/v1';
const IS_DEMO = process.env.DEMO_MODE === 'true';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SleeperRoster {
  roster_id: number;
  owner_id:  string | null;
  players:   string[] | null;
}
interface SleeperUser {
  user_id:      string;
  display_name: string;
  metadata?:    { team_name?: string };
}
interface SleeperMatchupRaw {
  roster_id:  number;
  matchup_id: number | null;
  points:     number;
  starters?:  string[];
}
interface SleeperNflState { week: number; season: string }

export interface PlayerProjection {
  playerId:      string;
  name:          string;
  position:      string;
  team:          string | null;
  floor:         number;
  ceiling:       number;
  projected:     number;
  defAdjustment: number;
  weatherNote:   string | null;
}
export interface TeamProjection {
  name:      string;
  rosterId:  number;
  floor:     number;
  ceiling:   number;
  projected: number;
}
export interface WeatherInfo {
  team:        string;
  tempF:       number;
  windMph:     number;
  precipPct:   number;
  stadiumName: string;
  note:        string;
}
export interface VegasLine {
  homeTeam: string;
  awayTeam: string;
  total:    number;
  spread:   number;
  sport?:   string; // populated in demo mode (e.g. "NBA", "MLB")
}
export interface MatchupReportResponse {
  week:            number;
  season:          number;
  myTeam:          TeamProjection;
  opponent:        TeamProjection;
  myPlayers:       PlayerProjection[];
  opponentPlayers: PlayerProjection[];
  weather:         WeatherInfo[] | null;
  vegasLines:      VegasLine[] | null;
  narrative:       string;
  demo?:           boolean;
}

// ─── Mock data types (used only when IS_DEMO) ─────────────────────────────────

interface MockPlayer { id: string; name: string; position: string; team: string }
interface MockRoster { name: string; rosterId: number; players: MockPlayer[] }
const mockData = MOCK_MATCHUP as unknown as { team1: MockRoster; team2: MockRoster };

// ─── Stadium data ─────────────────────────────────────────────────────────────

interface Stadium { lat: number; lon: number; name: string; dome: boolean }

const STADIUM_COORDS: Record<string, Stadium> = {
  ARI: { lat: 33.5277,  lon: -112.2626, name: 'State Farm Stadium',       dome: true  },
  ATL: { lat: 33.7554,  lon: -84.4009,  name: 'Mercedes-Benz Stadium',    dome: true  },
  BAL: { lat: 39.2780,  lon: -76.6227,  name: 'M&T Bank Stadium',         dome: false },
  BUF: { lat: 42.7738,  lon: -78.7870,  name: 'Highmark Stadium',         dome: false },
  CAR: { lat: 35.2258,  lon: -80.8528,  name: 'Bank of America Stadium',  dome: false },
  CHI: { lat: 41.8623,  lon: -87.6167,  name: 'Soldier Field',            dome: false },
  CIN: { lat: 39.0955,  lon: -84.5160,  name: 'Paycor Stadium',           dome: false },
  CLE: { lat: 41.5061,  lon: -81.6995,  name: 'Cleveland Browns Stadium', dome: false },
  DAL: { lat: 32.7473,  lon: -97.0945,  name: 'AT&T Stadium',             dome: true  },
  DEN: { lat: 39.7439,  lon: -105.0201, name: 'Empower Field',            dome: false },
  DET: { lat: 42.3400,  lon: -83.0456,  name: 'Ford Field',               dome: true  },
  GB:  { lat: 44.5013,  lon: -88.0622,  name: 'Lambeau Field',            dome: false },
  HOU: { lat: 29.6847,  lon: -95.4107,  name: 'NRG Stadium',              dome: true  },
  IND: { lat: 39.7601,  lon: -86.1639,  name: 'Lucas Oil Stadium',        dome: true  },
  JAX: { lat: 30.3239,  lon: -81.6373,  name: 'EverBank Stadium',         dome: false },
  KC:  { lat: 39.0489,  lon: -94.4839,  name: 'GEHA Field',               dome: false },
  LAC: { lat: 33.9535,  lon: -118.3392, name: 'SoFi Stadium',             dome: true  },
  LAR: { lat: 33.9535,  lon: -118.3392, name: 'SoFi Stadium',             dome: true  },
  LV:  { lat: 36.0909,  lon: -115.1833, name: 'Allegiant Stadium',        dome: true  },
  MIA: { lat: 25.9580,  lon: -80.2389,  name: 'Hard Rock Stadium',        dome: false },
  MIN: { lat: 44.9740,  lon: -93.2577,  name: 'U.S. Bank Stadium',        dome: true  },
  NE:  { lat: 42.0909,  lon: -71.2643,  name: 'Gillette Stadium',         dome: false },
  NO:  { lat: 29.9511,  lon: -90.0812,  name: 'Caesars Superdome',        dome: true  },
  NYG: { lat: 40.8135,  lon: -74.0745,  name: 'MetLife Stadium',          dome: false },
  NYJ: { lat: 40.8135,  lon: -74.0745,  name: 'MetLife Stadium',          dome: false },
  PHI: { lat: 39.9008,  lon: -75.1675,  name: 'Lincoln Financial Field',  dome: false },
  PIT: { lat: 40.4468,  lon: -80.0158,  name: 'Acrisure Stadium',         dome: false },
  SEA: { lat: 47.5952,  lon: -122.3316, name: 'Lumen Field',              dome: false },
  SF:  { lat: 37.4032,  lon: -121.9698, name: "Levi's Stadium",           dome: false },
  TB:  { lat: 27.9759,  lon: -82.5033,  name: 'Raymond James Stadium',    dome: false },
  TEN: { lat: 36.1665,  lon: -86.7713,  name: 'Nissan Stadium',           dome: false },
  WAS: { lat: 38.9079,  lon: -76.8645,  name: 'Northwest Stadium',        dome: false },
};

// ─── Caches ───────────────────────────────────────────────────────────────────

const matchupCache = new Map<string, { data: MatchupReportResponse; ts: number }>();
const weatherCache = new Map<string, { data: WeatherInfo; ts: number }>();
const oddsCache    = new Map<string, { data: VegasLine[]; ts: number }>();

const MATCHUP_TTL    = 15 * 60 * 1000; // 15 min
const DEMO_TTL       =      60 * 1000; // 1 min  (short so random week refreshes quickly)
const ENRICHMENT_TTL = 60 * 60 * 1000; // 1 hour

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function sleeperGet<T>(path: string, revalidate = 300): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Sleeper ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ─── Statistics helpers ───────────────────────────────────────────────────────

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean    = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ─── Weather fetch ────────────────────────────────────────────────────────────

async function getWeather(team: string, week: number): Promise<WeatherInfo | null> {
  const stadium = STADIUM_COORDS[team];
  if (!stadium || stadium.dome) return null;

  const cacheKey = `${team}-${week}`;
  const hit = weatherCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < ENRICHMENT_TTL) return hit.data;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${stadium.lat}&longitude=${stadium.lon}` +
      `&hourly=temperature_2m,precipitation_probability,wind_speed_10m` +
      `&forecast_days=7&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;

    const json = await res.json() as {
      hourly: {
        time:                     string[];
        temperature_2m:           number[];
        precipitation_probability: number[];
        wind_speed_10m:           number[];
      };
    };

    // Find the next Sunday 1 pm slot (or closest future slot)
    const now = new Date();
    const times = json.hourly.time;
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i]);
      if (t < now) continue;
      const dayScore   = t.getDay() === 0 ? 0 : Math.abs(t.getDay() - 0) * 24;
      const hourScore  = Math.abs(t.getHours() - 13);
      const totalScore = dayScore + hourScore;
      if (totalScore < bestScore) { bestScore = totalScore; bestIdx = i; }
    }

    const tempF    = Math.round(json.hourly.temperature_2m[bestIdx]            ?? 55);
    const windMph  = Math.round(json.hourly.wind_speed_10m[bestIdx]            ?? 0);
    const precipPct = json.hourly.precipitation_probability[bestIdx]           ?? 0;

    const notes: string[] = [];
    if (windMph  >  20) notes.push(`High wind (${windMph} mph) — passing may suffer`);
    if (precipPct > 60) notes.push(`Rain likely (${precipPct}%) — impacts passing/receiving`);
    if (tempF    <  20) notes.push(`Extreme cold (${tempF}°F)`);

    const data: WeatherInfo = {
      team, tempF, windMph, precipPct,
      stadiumName: stadium.name,
      note: notes.join('; ') || 'Good conditions',
    };
    weatherCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// ─── Odds fetch ───────────────────────────────────────────────────────────────

// In-season sport preference order for demo/live mode
const SPORT_PRIORITY = [
  'basketball_nba',
  'icehockey_nhl',
  'baseball_mlb',
  'soccer_usa_mls',
  'americanfootball_nfl',
] as const;

/** Fetches odds for the first currently-active sport we can find. Used in DEMO_MODE. */
async function getLiveOdds(apiKey: string): Promise<VegasLine[] | null> {
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
  if (!chosen) {
    chosen = sports.find((s) => s.active);
  }
  if (!chosen) return null;

  // Step 2 — fetch odds for chosen sport
  const oddsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/${chosen.key}/odds/` +
    `?apiKey=${apiKey}&regions=us&markets=totals,spreads&bookmakers=draftkings`,
    { next: { revalidate: 3600 } },
  );
  if (!oddsRes.ok) return null;

  const games = await oddsRes.json() as Array<{
    home_team:   string;
    away_team:   string;
    bookmakers:  Array<{
      markets: Array<{
        key:      string;
        outcomes: Array<{ name: string; price: number; point?: number }>;
      }>;
    }>;
  }>;

  // Shorten team names to last word for display (e.g. "Boston Celtics" → "Celtics")
  const sportLabel = chosen.title.replace(/^.*?_/, '').toUpperCase(); // "NBA", "MLB" etc.

  const lines: VegasLine[] = games.slice(0, 6).map((g) => {
    const bk     = g.bookmakers[0];
    const totals  = bk?.markets.find((m) => m.key === 'totals');
    const spreads = bk?.markets.find((m) => m.key === 'spreads');
    const total   = totals?.outcomes[0]?.point                             ?? 0;
    const spread  = spreads?.outcomes.find((o) => o.name === g.home_team)?.point ?? 0;
    return {
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      total,
      spread,
      sport: sportLabel,
    };
  });

  return lines.length > 0 ? lines : null;
}

/** Fetches current NFL game odds (production mode). */
async function getNflOdds(week: number): Promise<VegasLine[] | null> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;

  const cacheKey = `nfl-odds-${week}`;
  const hit = oddsCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < ENRICHMENT_TTL) return hit.data;

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

    oddsCache.set(cacheKey, { data: lines, ts: Date.now() });
    return lines;
  } catch {
    return null;
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId')?.trim();
  const userId   = searchParams.get('userId')?.trim();

  if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 });
  if (!userId)   return NextResponse.json({ error: 'userId is required' },   { status: 400 });

  // ── Check response cache ───────────────────────────────────────────────────
  // Demo uses a short TTL so repeated clicks cycle through different random weeks.
  const cacheKey = IS_DEMO
    ? `demo-${leagueId}`
    : `${leagueId}-${userId}-${searchParams.get('week') ?? 'cur'}`;
  const cacheTTL  = IS_DEMO ? DEMO_TTL : MATCHUP_TTL;
  const cached    = matchupCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < cacheTTL) return NextResponse.json(cached.data);

  try {
    // ── Variables set differently between demo and live ──────────────────────
    let myPlayerIds:  string[];
    let oppPlayerIds: string[];
    let myName:       string;
    let oppName:      string;
    let myRosterId:   number;
    let oppRosterId:  number;
    let effectiveSeason: number;
    let effectiveWeek:   number;
    let localPlayerMap:  Map<string, SleeperPlayerInfo>;

    if (IS_DEMO) {
      // ── DEMO: load mock rosters, pick random regular-season week ─────────
      effectiveSeason = Number(process.env.NFL_SEASON ?? '2025');
      effectiveWeek   = Math.floor(Math.random() * 17) + 1; // weeks 1-17

      myPlayerIds  = mockData.team1.players.map((p) => p.id);
      oppPlayerIds = mockData.team2.players.map((p) => p.id);
      myName       = mockData.team1.name;
      oppName      = mockData.team2.name;
      myRosterId   = mockData.team1.rosterId;
      oppRosterId  = mockData.team2.rosterId;

      // Build a local player map from the mock roster so we don't hit Sleeper
      localPlayerMap = new Map<string, SleeperPlayerInfo>();
      for (const p of [...mockData.team1.players, ...mockData.team2.players]) {
        localPlayerMap.set(p.id, { name: p.name, position: p.position, team: p.team });
      }
    } else {
      // ── LIVE: resolve from Sleeper API ────────────────────────────────────
      effectiveSeason = Number(searchParams.get('season') ?? '2025');
      let rawWeek = searchParams.get('week') ? Number(searchParams.get('week')) : null;
      if (!rawWeek) {
        try {
          const state = await sleeperGet<SleeperNflState>('/state/nfl', 60);
          rawWeek = state.week;
        } catch {
          rawWeek = 1;
        }
      }
      effectiveWeek = rawWeek;

      const [rosters, users, matchupsRaw, playerMapFull] = await Promise.all([
        sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
        sleeperGet<SleeperUser[]>(`/league/${leagueId}/users`),
        sleeperGet<SleeperMatchupRaw[]>(`/league/${leagueId}/matchups/${effectiveWeek}`),
        getPlayerMap().catch(() => new Map<string, SleeperPlayerInfo>()),
      ]);
      localPlayerMap = playerMapFull;

      const teamNameOf = (ownerId: string | null) => {
        if (!ownerId) return 'Unknown';
        const u = users.find((u) => u.user_id === ownerId);
        return u?.metadata?.team_name?.trim() || u?.display_name || 'Unknown';
      };

      const myRoster = rosters.find((r) => r.owner_id === userId);
      if (!myRoster) return NextResponse.json({ error: 'Roster not found for this user' }, { status: 404 });

      const myMatchup = matchupsRaw.find((m) => m.roster_id === myRoster.roster_id);
      if (!myMatchup?.matchup_id) {
        return NextResponse.json({ error: 'No matchup found for this week' }, { status: 404 });
      }

      const oppMatchup = matchupsRaw.find(
        (m) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster.roster_id,
      );
      if (!oppMatchup) return NextResponse.json({ error: 'Opponent not found' }, { status: 404 });

      const oppRoster = rosters.find((r) => r.roster_id === oppMatchup.roster_id);

      myPlayerIds  = myRoster.players ?? [];
      oppPlayerIds = oppRoster?.players ?? [];
      myName       = teamNameOf(myRoster.owner_id);
      oppName      = teamNameOf(oppRoster?.owner_id ?? null);
      myRosterId   = myRoster.roster_id;
      oppRosterId  = oppRoster?.roster_id ?? 0;
    }

    // ── Build player stats (shared) ──────────────────────────────────────────
    const allIds      = [...new Set([...myPlayerIds, ...oppPlayerIds])];
    const completedWk = Math.max(1, effectiveWeek - 1);
    const sinceWk     = Math.max(1, completedWk - 5);

    let statsRows: { playerId: string; week: number; fantasyPointsPpr: number | null }[] = [];
    if (allIds.length > 0) {
      statsRows = await prisma.nflWeeklyStat.findMany({
        where: {
          season:   effectiveSeason,
          playerId: { in: allIds },
          week:     { gte: sinceWk, lte: completedWk },
        },
        select: { playerId: true, week: true, fantasyPointsPpr: true },
      });
    }

    const playerWeeklyPts = new Map<string, number[]>();
    for (const row of statsRows) {
      if (row.fantasyPointsPpr === null) continue;
      const arr = playerWeeklyPts.get(row.playerId) ?? [];
      arr.push(row.fantasyPointsPpr);
      playerWeeklyPts.set(row.playerId, arr);
    }

    // ── Defensive strength ───────────────────────────────────────────────────
    const defRows = await prisma.nflWeeklyStat.groupBy({
      by:    ['opponentTeam', 'position'],
      where: { season: effectiveSeason, opponentTeam: { not: null }, fantasyPointsPpr: { not: null } },
      _avg:  { fantasyPointsPpr: true },
    });

    const leagueAvgByPos = new Map<string, number[]>();
    const defAllowed     = new Map<string, number>(); // "TEAM-POS" → avg pts allowed
    for (const row of defRows) {
      const key = `${row.opponentTeam}-${row.position}`;
      defAllowed.set(key, row._avg.fantasyPointsPpr ?? 0);
      const arr = leagueAvgByPos.get(row.position ?? '') ?? [];
      arr.push(row._avg.fantasyPointsPpr ?? 0);
      leagueAvgByPos.set(row.position ?? '', arr);
    }

    function leagueAvgForPos(pos: string): number {
      const arr = leagueAvgByPos.get(pos);
      if (!arr || arr.length === 0) return 0;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    }
    function defAdjMultiplier(opponentTeam: string | null, pos: string): number {
      if (!opponentTeam) return 1;
      const allowed = defAllowed.get(`${opponentTeam}-${pos}`);
      const avg     = leagueAvgForPos(pos);
      if (!allowed || avg === 0) return 1;
      return Math.max(0.85, Math.min(1.15, allowed / avg));
    }

    // ── Weather (always calls the real Open-Meteo API) ───────────────────────
    const outdoorTeams = new Set<string>();
    for (const pid of allIds) {
      const info = localPlayerMap.get(pid);
      if (info?.team && !STADIUM_COORDS[info.team]?.dome) {
        outdoorTeams.add(info.team);
      }
    }
    const weatherResults = await Promise.all(
      [...outdoorTeams].map((t) => getWeather(t, effectiveWeek)),
    );
    const weatherMap = new Map<string, WeatherInfo>();
    for (const w of weatherResults) { if (w) weatherMap.set(w.team, w); }
    const weatherArr = weatherResults.filter(Boolean) as WeatherInfo[];

    // ── Vegas / live odds ────────────────────────────────────────────────────
    const apiKey   = process.env.ODDS_API_KEY;
    let vegasLines: VegasLine[] | null = null;
    if (apiKey) {
      if (IS_DEMO) {
        // Demo: pull live odds from whatever sport is currently in-season
        const demoCacheKey = 'demo-live-odds';
        const demoHit = oddsCache.get(demoCacheKey);
        if (demoHit && Date.now() - demoHit.ts < ENRICHMENT_TTL) {
          vegasLines = demoHit.data;
        } else {
          vegasLines = await getLiveOdds(apiKey).catch(() => null);
          if (vegasLines) oddsCache.set(demoCacheKey, { data: vegasLines, ts: Date.now() });
        }
      } else {
        vegasLines = await getNflOdds(effectiveWeek).catch(() => null);
      }
    }

    // ── Project each player ──────────────────────────────────────────────────
    function projectPlayer(pid: string): PlayerProjection {
      const info = localPlayerMap.get(pid);
      const name = info?.name      ?? `#${pid}`;
      const pos  = info?.position  ?? 'UNK';
      const team = info?.team      ?? null;
      const pts  = playerWeeklyPts.get(pid) ?? [];

      const mean       = pts.length > 0 ? pts.reduce((a, b) => a + b, 0) / pts.length : 0;
      const sd         = stdDev(pts);
      const rawFloor   = Math.max(0, mean - 1.28 * sd);
      const rawCeiling = mean + 1.28 * sd;

      const defMult = defAdjMultiplier(null, pos); // team's opponent unknown without weekly schedule

      let weatherMult = 1;
      let weatherNote: string | null = null;
      const wx = team ? weatherMap.get(team) : null;
      if (wx) {
        const isPassingPos = ['QB', 'WR', 'TE'].includes(pos);
        const isKicker     = pos === 'K';
        if (wx.windMph > 20 && (isPassingPos || isKicker)) {
          weatherMult *= 0.92;
          weatherNote  = `Wind ${wx.windMph}mph`;
        }
        if (wx.precipPct > 60 && isPassingPos) {
          weatherMult *= 0.95;
          weatherNote  = (weatherNote ? weatherNote + ', ' : '') + `Rain ${wx.precipPct}%`;
        }
      }

      const adj       = defMult * weatherMult;
      const floor     = parseFloat((rawFloor   * adj).toFixed(1));
      const ceiling   = parseFloat((rawCeiling * adj).toFixed(1));
      const projected = parseFloat((mean       * adj).toFixed(1));

      return { playerId: pid, name, position: pos, team, floor, ceiling, projected, defAdjustment: adj, weatherNote };
    }

    const myProjections  = myPlayerIds.map((pid)  => projectPlayer(pid));
    const oppProjections = oppPlayerIds.map((pid) => projectPlayer(pid));

    function sumTeam(projs: PlayerProjection[], name: string, rosterId: number): TeamProjection {
      return {
        name,
        rosterId,
        floor:     parseFloat(projs.reduce((s, p) => s + p.floor,     0).toFixed(1)),
        ceiling:   parseFloat(projs.reduce((s, p) => s + p.ceiling,   0).toFixed(1)),
        projected: parseFloat(projs.reduce((s, p) => s + p.projected, 0).toFixed(1)),
      };
    }

    const myTeam   = sumTeam(myProjections,  myName,  myRosterId);
    const opponent = sumTeam(oppProjections, oppName, oppRosterId);

    // ── Narrative ────────────────────────────────────────────────────────────
    const myWins   = myTeam.floor > opponent.ceiling;
    const myLikely = myTeam.projected > opponent.projected;
    const close    = Math.abs(myTeam.projected - opponent.projected) < 10;
    const wxImpact = weatherArr.some((w) => w.windMph > 20 || w.precipPct > 60);

    let narrative = '';
    if (myWins) {
      narrative = `Your floor (${myTeam.floor}) exceeds their ceiling (${opponent.ceiling}) — you're a strong favourite this week. `;
    } else if (myLikely && !close) {
      narrative = `You project ahead ${myTeam.projected.toFixed(1)}–${opponent.projected.toFixed(1)}, though the ranges overlap. `;
    } else if (close) {
      narrative = `Tight matchup — projected scores are within 10 points of each other. `;
    } else {
      narrative = `You're the underdog (${myTeam.projected.toFixed(1)} vs ${opponent.projected.toFixed(1)}), but your ceiling (${myTeam.ceiling}) still gives you a path. `;
    }
    if (wxImpact) {
      narrative += `Weather may be a factor: ${weatherArr.filter((w) => w.windMph > 20 || w.precipPct > 60).map((w) => w.note).join('; ')}.`;
    }
    if (IS_DEMO) {
      narrative += ` [Demo — ${effectiveSeason} W${effectiveWeek} stats · live ${vegasLines?.[0]?.sport ?? 'no'} odds]`;
    }

    const result: MatchupReportResponse = {
      week:    effectiveWeek,
      season:  effectiveSeason,
      myTeam,
      opponent,
      myPlayers:       myProjections,
      opponentPlayers: oppProjections,
      weather:   weatherArr.length > 0 ? weatherArr : null,
      vegasLines,
      narrative: narrative.trim(),
      ...(IS_DEMO && { demo: true }),
    };

    matchupCache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result);

  } catch (err) {
    const msg    = err instanceof Error ? err.message : 'Upstream error';
    const status = msg.includes('404') ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
