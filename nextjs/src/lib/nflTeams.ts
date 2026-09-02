// src/lib/nflTeams.ts
//
// NFL team abbreviations and the full names other feeds use.
//
// Needed because the odds API names teams in full ("Seattle Seahawks") while
// everything else in this app — rosters, fixtures, stat rows — uses the
// abbreviation. Matching a betting line to a game means bridging the two.
//
// Generated from nflverse's team table, which is also the source the fixtures
// come from, so the abbreviations agree by construction.

/** Current abbreviation → full name. */
export const NFL_TEAM_NAMES: Record<string, string> = {
  ARI: 'Arizona Cardinals',
  ATL: 'Atlanta Falcons',
  BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers',
  CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals',
  CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos',
  DET: 'Detroit Lions',
  GB:  'Green Bay Packers',
  HOU: 'Houston Texans',
  IND: 'Indianapolis Colts',
  JAX: 'Jacksonville Jaguars',
  KC:  'Kansas City Chiefs',
  LA:  'Los Angeles Rams',
  LAC: 'Los Angeles Chargers',
  LAR: 'Los Angeles Rams',
  LV:  'Las Vegas Raiders',
  MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings',
  NE:  'New England Patriots',
  NO:  'New Orleans Saints',
  NYG: 'New York Giants',
  NYJ: 'New York Jets',
  PHI: 'Philadelphia Eagles',
  PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks',
  SF:  'San Francisco 49ers',
  TB:  'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans',
  WAS: 'Washington Commanders',
};

/**
 * Full name → abbreviation.
 *
 * Both LA and LAR mean the Rams in nflverse data; LAR wins here because that is
 * what the fixtures carry.
 */
const BY_NAME: Map<string, string> = new Map(
  Object.entries(NFL_TEAM_NAMES)
    .filter(([abbr]) => abbr !== 'LA')
    .map(([abbr, name]) => [name.toLowerCase(), abbr]),
);

/**
 * Resolves a team named by another feed to its abbreviation.
 *
 * Three passes, narrowest first:
 *
 *   1. The exact name.
 *   2. The nickname — the last word. Feeds disagree about cities far more than
 *      about nicknames, so "LA Chargers" still lands on LAC.
 *   3. The city, but only when it names exactly one team. This catches a feed
 *      still using a retired name ("Washington Football Team"), and refuses to
 *      choose between the Giants and the Jets, or the Rams and the Chargers.
 *
 * Returns null rather than guessing. The dialog then says there is no line for
 * the game, which is better than showing another game's.
 */
export function abbrOf(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const name = fullName.trim().toLowerCase();
  if (!name) return null;

  const exact = BY_NAME.get(name);
  if (exact) return exact;

  const words = name.split(/\s+/);
  const nickname = words.at(-1);
  if (nickname) {
    for (const [full, abbr] of BY_NAME) {
      if (full.endsWith(` ${nickname}`)) return abbr;
    }
  }

  const city = words[0];
  if (city) {
    const inCity = [...BY_NAME].filter(([full]) => full.startsWith(`${city} `));
    if (inCity.length === 1) return inCity[0][1];
  }
  return null;
}

/**
 * Codes that mean the same franchise in different feeds.
 *
 * nflverse's schedules call the Rams `LA`; Sleeper calls them `LAR`, and so do
 * its stat rows. Left unreconciled, every Rams player fails to find his own
 * fixture — no opponent, no forecast, no line — every week of the season, and
 * silently, because a missing fixture looks the same as a bye.
 *
 * The relocations are here for the same reason: historical rows still carry the
 * old city's code.
 */
const TEAM_ALIASES: Record<string, string> = {
  LA:  'LAR',   // nflverse schedules
  STL: 'LAR',   // pre-2016
  SD:  'LAC',   // pre-2017
  OAK: 'LV',    // pre-2020
  WSH: 'WAS',   // some feeds
  JAC: 'JAX',   // some feeds
};

/**
 * The one code this app uses for a team.
 *
 * Applied on both sides of any join between feeds — a fixture's team and a
 * player's team have to agree before a lookup can work.
 */
export function canonicalTeam(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  if (!upper) return null;
  return TEAM_ALIASES[upper] ?? upper;
}

/**
 * Canonical code → the code nflverse writes, where they differ.
 *
 * The inverse of an alias is ambiguous in general — LAR could have been LA or
 * STL — so only the mapping that current data actually needs is stated. This is
 * for reaching *stored* rows, which carry nflverse's spelling: a team defense is
 * filed under `LA`, while Sleeper asks for it as `LAR`.
 */
const NFLVERSE_CODES: Record<string, string> = {
  LAR: 'LA',
};

/**
 * The code the stat tables store this team under.
 *
 * Use when querying NflWeeklyStat by team; use `canonicalTeam` for everything
 * that stays inside the app.
 */
export function statsCodeOf(code: string | null | undefined): string | null {
  const canonical = canonicalTeam(code);
  if (!canonical) return null;
  return NFLVERSE_CODES[canonical] ?? canonical;
}
