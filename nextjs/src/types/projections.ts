import type { PlayerContext } from '@/lib/matchupContext';

export interface PlayerProjection {
  playerId:        string;
  /** Sleeper numeric ID — use for CDN headshots. Equals playerId in live mode. */
  sleeperPlayerId: string;
  name:            string;
  position:        string;
  team:            string | null;
  floor:           number;
  ceiling:         number;
  projected:       number;
  /**
   * Standard deviation of this player's recent scores, after the weather
   * multiplier. 0 when fewer than two games are in the window.
   *
   * Carried explicitly because the team band needs it and it cannot be
   * recovered from the floor/ceiling pair: floor is clamped at 0, so for a
   * volatile low-scorer the visible band is narrower than the real spread.
   */
  sigma:           number;
  /**
   * Games behind this projection, within the form window.
   *
   * 0 or 1 means the numbers are mostly the positional baseline rather than the
   * player's own record — see src/lib/projection.ts. Surfaced so a reader can
   * tell an observed projection from an inferred one, and so a player who
   * should have a record but shows none stays visible as a data problem.
   */
  games:           number;
  /**
   * Fixture, opposing unit, forecast and betting line for this player's game.
   *
   * Read-only context for the dialog. Nothing here feeds the projection above —
   * the numbers are what they were before it existed. See
   * src/lib/matchupContext.ts for the direction each factor pushes.
   */
  context:         PlayerContext;
  /**
   * Whether this player is in the starting lineup this week.
   *
   * Only starters count toward the team totals; the bench is still returned so
   * the per-player breakdown stays complete. Defaults to true when the league
   * has not set a lineup yet — see the route for why.
   */
  starter:         boolean;
}

export interface TeamProjection {
  name:      string;
  rosterId:  number;
  /**
   * Floor, ceiling and projection over the STARTING LINEUP only.
   *
   * The band is `projected ± 1.28 × sigma`, rebuilt from the combined spread —
   * it is NOT the sum of the players' own floors and ceilings, which would
   * describe every starter having a bad week simultaneously.
   */
  floor:     number;
  ceiling:   number;
  projected: number;
  /** Combined standard deviation of the lineup: √(Σ of each starter's σ²). */
  sigma:     number;
  /** Number of players the totals above are built from. */
  starterCount: number;
  /** Projected points sitting on the bench — not included in `projected`. */
  benchProjected: number;
  /** Number of players on the bench. */
  benchCount:     number;
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
  sport?:   string;
}

export interface MatchupReportResponse {
  week:            number;
  season:          number;
  myTeam:          TeamProjection;
  opponent:        TeamProjection;
  myPlayers:       PlayerProjection[];
  opponentPlayers: PlayerProjection[];
  narrative:       string;
  /** Season the underlying stats came from — see src/lib/statsSeason.ts. */
  statsSeason?:   number;
  /** True when statsSeason is not the season being played (pre-kickoff, sync lag). */
  statsFallback?: boolean;
}
