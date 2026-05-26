// src/lib/sleeper/types.ts
//
// Canonical Sleeper API response shapes used across routes and hooks.
//
// All Sleeper-specific interfaces must be imported from this file rather than
// redefined inline. Keeping them here makes it easy to track API changes and
// ensures every route stays in sync with the same field names and nullability.
//
// Fields marked with `?` are present in the Sleeper API but optional in
// practice — either because they are omitted for certain league configurations
// or because the API omits them when the value is falsy.

/** A single team's roster entry returned by /league/{id}/rosters. */
export interface SleeperRoster {
  /** Numeric roster ID (1-indexed). */
  roster_id: number;
  /** Sleeper user ID of the roster owner; null for unowned / orphaned rosters. */
  owner_id:  string | null;
  /** Array of Sleeper player IDs currently on this roster; null when empty. */
  players:   string[] | null;
  settings: {
    wins:          number;
    losses:        number;
    ties?:         number;
    /** Integer part of fantasy points scored (e.g. 1234 for 1234.56 pts). */
    fpts:          number;
    /** Decimal part of fantasy points, zero-padded to 2 digits (e.g. 56). */
    fpts_decimal:  number;
    /** 1-indexed division number; omitted when the league has no divisions. */
    division?:     number;
  };
}

/** A single league member returned by /league/{id}/users. */
export interface SleeperUser {
  user_id:      string;
  /** Sleeper login handle (may differ from display_name). */
  username?:    string;
  display_name: string;
  /** Sleeper avatar hash; combine with Sleeper's CDN URL to render. */
  avatar?:      string | null;
  metadata?: {
    /** Custom team name set by the manager in the Sleeper app. */
    team_name?: string;
  };
}

/** League metadata returned by /league/{id}. */
export interface SleeperLeagueRaw {
  league_id:            string;
  name:                 string;
  /** Season year as a string, e.g. "2025". */
  season:               string;
  total_rosters:        number;
  /** Lifecycle status: "pre_draft" | "drafting" | "in_season" | "complete". */
  status:               string;
  /** Sleeper ID of last season's league; null for newly created leagues. */
  previous_league_id?:  string | null;
  settings: {
    /** Number of divisions (typically 2; 0 means no divisions). */
    divisions?:          number;
    /** Week number when the fantasy playoffs begin. */
    playoff_week_start?: number;
  };
}

/** One side of a matchup returned by /league/{id}/matchups/{week}. */
export interface SleeperMatchupRaw {
  roster_id:        number;
  /** Identifies which matchup pair this entry belongs to; null for a bye week. */
  matchup_id:       number | null;
  points:           number;
  /** Ordered list of starter player IDs selected by the manager. */
  starters?:        string[];
  /** Fantasy points scored by each starter (parallel array with starters). */
  starters_points?: number[];
}

/** NFL season/week state returned by /state/nfl. */
export interface SleeperNflState {
  /** Current NFL week number (1–18 regular season, 19+ playoffs). */
  week:   number;
  /** Current NFL season year as a string, e.g. "2025". */
  season: string;
}

/** A single player entry from the Sleeper trending endpoint. */
export interface SleeperTrendingRaw {
  /** Sleeper player ID. */
  player_id: string;
  /** Number of waiver adds or drops in the lookback window. */
  count:     number;
}
