// src/lib/matchupContext.ts
//
// The case for and against a projection, assembled for a reader rather than for
// the arithmetic.
//
// Nothing here feeds the projection. The numbers on the panel are what they were
// before this module existed; this is the context a manager needs to decide
// whether to trust one — the conditions the game is played in, the defense on
// the other side, and what the bookmakers think of it.
//
// All three depend on knowing which game a player is in, which the app could not
// answer until NflGame existed. That is why weather guessed at each player's own
// home stadium, why the opponent-defense multiplier was removed, and why the
// Vegas lines were the first three on the slate rather than the relevant one.
//
// The direction of each effect is stated on the context itself, because it is
// not symmetric and it is easy to get backwards:
//
//   Bad weather   → offense and kickers down, defenses UP.
//   Strong defense → the offense facing it down.
//   Strong offense → the defense facing it down.

import { prisma } from '@/lib/prisma';
import { STADIUM_COORDS, NEUTRAL_VENUE_COORDS, type Stadium } from '@/lib/stadiums';
import { getVenueWeather } from '@/lib/weather';
import { canonicalTeam } from '@/lib/nflTeams';
import type { WeatherInfo, VegasLine } from '@/types/projections';

/** A fixture as the context layer needs it. */
export interface Fixture {
  homeTeam: string;
  awayTeam: string;
  /** ISO-8601 kickoff in US Eastern time — the zone nflverse publishes in. */
  kickoff:  string | null;
  stadium:  string | null;
  /** outdoors | dome | closed */
  roof:     string | null;
  /** Home | Neutral */
  location: string | null;
}

/**
 * How a unit compares to the rest of the league, as a rank and a plain word.
 *
 * `rank` is 1 = best. For a defense that means fewest points allowed to the
 * position; for an offense, most points scored.
 */
export interface UnitStrength {
  team:    string;
  rank:    number;
  of:      number;
  /** Points per game allowed (defense) or scored (offense). */
  perGame: number;
  /** elite | strong | average | soft — a word for the rank. */
  tier:    string;
}

export interface PlayerContext {
  /** The player's opponent this week, or null when no fixture was found. */
  opponent:   string | null;
  /** True when the player's team is at home. */
  home:       boolean;
  kickoff:    string | null;
  stadium:    string | null;
  /** Weather at the venue, or null for a roof, a neutral site, or no forecast. */
  weather:    WeatherInfo | null;
  /** Why weather is absent, when it is. */
  weatherNote: string | null;
  /** The opposing unit: their defense for an offensive player, their offense for a DEF. */
  opposing:   UnitStrength | null;
  /** The betting line for this player's game. */
  line:       VegasLine | null;
}

/**
 * Whether a game is played under a roof.
 *
 * nflverse leaves `roof` null on some fixtures until closer to kickoff — two of
 * the sixteen in week 1 of 2026, including Indianapolis. The stadium table
 * already knows which grounds are covered, so it answers when the fixture does
 * not; otherwise a dome reads as "no forecast available", which invites the
 * reader to wonder about weather that cannot matter.
 */
function isIndoors(game: Fixture): boolean {
  // A venue we know beats the feed. nflverse marks the Melbourne Cricket
  // Ground — an open bowl with no roof — as a dome.
  const named = game.stadium ? NEUTRAL_VENUE_COORDS[game.stadium] : undefined;
  if (named) return named.dome;

  if (game.roof === 'dome' || game.roof === 'closed') return true;
  if (game.roof === 'outdoors') return false;
  return STADIUM_COORDS[game.homeTeam]?.dome ?? false;
}

/** Rank thresholds, as a share of the league. */
function tierOf(rank: number, of: number): string {
  const pct = rank / Math.max(1, of);
  if (pct <= 0.25) return 'elite';
  if (pct <= 0.5)  return 'strong';
  if (pct <= 0.75) return 'average';
  return 'soft';
}

/**
 * Every fixture for a week, indexed by team.
 *
 * Both sides of a game map to the same row, so a lookup by either team finds it.
 */
export async function fixturesByTeam(
  season: number,
  week: number,
): Promise<Map<string, Fixture>> {
  const games = await prisma.nflGame.findMany({
    where:  { season, week },
    select: {
      homeTeam: true, awayTeam: true, kickoff: true,
      stadium: true, roof: true, location: true,
    },
  });

  const byTeam = new Map<string, Fixture>();
  for (const raw of games) {
    // Both sides normalised: the schedule feed calls the Rams LA and every other
    // feed here calls them LAR, so an un-normalised index misses them entirely.
    const g: Fixture = {
      ...raw,
      homeTeam: canonicalTeam(raw.homeTeam) ?? raw.homeTeam,
      awayTeam: canonicalTeam(raw.awayTeam) ?? raw.awayTeam,
    };
    byTeam.set(g.homeTeam, g);
    byTeam.set(g.awayTeam, g);
  }
  return byTeam;
}

/**
 * Where a game is played, as coordinates.
 *
 * A neutral site is not automatically un-forecastable. Most are ordinary NFL
 * grounds hosting an extra game, where the home team's coordinates are exactly
 * right; the ones that are not are abroad, and have coordinates of their own.
 */
export function venueOf(game: Fixture): Stadium | null {
  const named = game.stadium ? NEUTRAL_VENUE_COORDS[game.stadium] : undefined;
  if (named) return named;

  const home = STADIUM_COORDS[game.homeTeam];
  if (!home) return null;

  // A neutral game at a venue we cannot place is the one case with no answer:
  // the nominal home team's ground is somewhere the game is not being played.
  if (game.location === 'Neutral' && game.stadium && game.stadium !== home.name) {
    return null;
  }
  return home;
}

/**
 * Points each defense allows to a position, per game, ranked.
 *
 * Built from the same weekly rows the positional baselines are, grouped by the
 * team a player faced. A defense that gave up little to tight ends ranks 1 for
 * TE.
 *
 * Takes the rows rather than fetching them: they are the window's whole
 * population, which the caller has already loaded for the baselines, and
 * scoring a kicker needs every kicking column — a narrower select scores each
 * one at zero and makes the K row of this table meaningless.
 *
 * @returns "TEAM|POS" → what that defense concedes to the position,
 *          "TEAM"     → what it concedes overall,
 *          "OFF|TEAM" → what that offense produces, for a defense's view.
 */
export function unitStrengths<T extends {
  position: string | null;
  team: string | null;
  opponentTeam: string | null;
  week: number;
}>(
  rows: T[],
  scorer: (row: T) => number,
): Map<string, UnitStrength> {
  // Points conceded by each defense to each position, and weeks seen.
  const allowed = new Map<string, { points: number; weeks: Set<number> }>();
  // Points produced by each offense, for the reverse lookup a DEF needs.
  const scored  = new Map<string, { points: number; weeks: Set<number> }>();

  for (const row of rows) {
    const pts = scorer(row);
    const add = (map: typeof allowed, key: string) => {
      const e = map.get(key) ?? { points: 0, weeks: new Set<number>() };
      e.points += pts;
      e.weeks.add(row.week);
      map.set(key, e);
    };
    if (row.position === 'DEF') continue;   // a defense is not conceded to
    // Stat rows carry nflverse's spelling; fixtures and rosters carry the app's.
    // Both sides of this join have to agree or the Rams never match.
    const against = canonicalTeam(row.opponentTeam);
    const by      = canonicalTeam(row.team);
    if (against) {
      add(allowed, `${against}|${row.position ?? ''}`);
      add(allowed, against);                   // all positions, for a DEF's view
    }
    if (by) add(scored, by);
  }

  const out = new Map<string, UnitStrength>();

  // Rank within each key family: per position, and the bare team totals.
  const families = new Map<string, string[]>();
  for (const key of allowed.keys()) {
    const family = key.includes('|') ? key.split('|')[1] : 'ALL';
    families.set(family, [...(families.get(family) ?? []), key]);
  }

  for (const [, keys] of families) {
    const scoredKeys = keys.map((key) => {
      const e = allowed.get(key)!;
      return { key, perGame: e.points / Math.max(1, e.weeks.size) };
    });
    // Fewest points allowed ranks best.
    scoredKeys.sort((a, b) => a.perGame - b.perGame);
    scoredKeys.forEach(({ key, perGame }, i) => {
      out.set(key, {
        team:    key.split('|')[0],
        rank:    i + 1,
        of:      scoredKeys.length,
        perGame: Math.round(perGame * 10) / 10,
        tier:    tierOf(i + 1, scoredKeys.length),
      });
    });
  }

  // Offensive output, ranked the other way: most points scored ranks best.
  const offense = [...scored.entries()]
    .map(([team, e]) => ({ team, perGame: e.points / Math.max(1, e.weeks.size) }))
    .sort((a, b) => b.perGame - a.perGame);
  offense.forEach(({ team, perGame }, i) => {
    out.set(`OFF|${team}`, {
      team,
      rank:    i + 1,
      of:      offense.length,
      perGame: Math.round(perGame * 10) / 10,
      tier:    tierOf(i + 1, offense.length),
    });
  });

  return out;
}

/**
 * Assembles one player's context.
 *
 * @param team      The player's NFL team, or null if unknown.
 * @param position  Decides which opposing unit is relevant.
 * @param fixtures  From `fixturesByTeam`.
 * @param strengths From `unitStrengths`.
 * @param weather   Forecasts already fetched, keyed by home team.
 * @param lines     Vegas lines keyed "HOME|AWAY". Keying by team alone is wrong:
 *                  the odds feed returns the whole season at once, so a team
 *                  resolves to whichever of its games came last in the list.
 */
export function buildPlayerContext(
  team:      string | null,
  position:  string,
  fixtures:  Map<string, Fixture>,
  strengths: Map<string, UnitStrength>,
  weather:   Map<string, WeatherInfo>,
  lines:     Map<string, VegasLine>,
): PlayerContext {
  const empty: PlayerContext = {
    opponent: null, home: false, kickoff: null, stadium: null,
    weather: null, weatherNote: null, opposing: null, line: null,
  };
  const canonical = canonicalTeam(team);
  if (!canonical) return empty;

  // No fixture is a real state — a bye, or a schedule that has not synced — but
  // it should not blank the whole card. The betting lines carry their own
  // pairings, so when one names this team the opponent can be recovered from it
  // and the defense lookup still works. Only the venue is genuinely unknowable.
  const game = fixtures.get(canonical) ?? fixtureFromLines(canonical, lines);
  if (!game) {
    return { ...empty, weatherNote: 'No fixture found for this week — bye, or the schedule is not synced.' };
  }

  // Compared on the canonical code, not the raw one: a Rams player arriving as
  // LA against a fixture stored as LAR would read as the away side of his own
  // home game, and face the wrong defense.
  const home     = game.homeTeam === canonical;
  const opponent = home ? game.awayTeam : game.homeTeam;

  // A defense is judged against the offense it faces; everyone else against the
  // defense they face.
  const opposing = position === 'DEF'
    ? strengths.get(`OFF|${opponent}`) ?? null
    : strengths.get(`${opponent}|${position}`) ?? strengths.get(opponent) ?? null;

  let forecast: WeatherInfo | null = null;
  let note: string | null = null;
  if (isIndoors(game)) {
    note = `Indoors at ${game.stadium ?? 'a covered stadium'} — weather is not a factor.`;
  } else {
    forecast = weather.get(game.homeTeam) ?? null;
    if (!forecast) {
      note = game.location === 'Neutral'
        ? `Neutral site: ${game.stadium ?? 'venue'}. No forecast for this venue.`
        : game.stadium === null
          ? 'Venue unknown — this fixture came from the betting line, not the schedule.'
          : 'No forecast available for this venue.';
    }
  }

  return {
    opponent,
    home,
    kickoff: game.kickoff,
    stadium: game.stadium,
    weather: forecast,
    weatherNote: note,
    opposing,
    line: lines.get(`${game.homeTeam}|${game.awayTeam}`) ?? null,
  };
}

/**
 * Recovers a fixture from the betting lines when the schedule has none.
 *
 * The odds feed keys on the same pair, so a team named in it tells us who it is
 * playing and which side it is on. Enough for the opponent and the line; the
 * venue is left null, since the feed does not say where.
 */
function fixtureFromLines(team: string, lines: Map<string, VegasLine>): Fixture | null {
  for (const key of lines.keys()) {
    const [home, away] = key.split('|');
    if (home !== team && away !== team) continue;
    return {
      homeTeam: home, awayTeam: away,
      kickoff: null, stadium: null, roof: null, location: null,
    };
  }
  return null;
}

/** Fetches forecasts for every outdoor, non-neutral venue in play. */
export async function venueForecasts(
  fixtures: Map<string, Fixture>,
  week: number,
): Promise<Map<string, WeatherInfo>> {
  // Keyed on the nominal home team so a lookup by either side finds it, but
  // fetched at wherever the game is actually being played.
  const venues = new Map<string, Stadium>();
  for (const game of fixtures.values()) {
    if (isIndoors(game)) continue;
    const venue = venueOf(game);
    if (!venue || venue.dome) continue;
    venues.set(game.homeTeam, venue);
  }

  const results = await Promise.all(
    [...venues].map(([team, venue]) =>
      getVenueWeather(team, venue, week).catch(() => null),
    ),
  );
  const byTeam = new Map<string, WeatherInfo>();
  for (const w of results) if (w) byTeam.set(w.team, w);
  return byTeam;
}
