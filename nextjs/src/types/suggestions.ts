import type { PlayerContext } from '@/lib/matchupContext';

/**
 * The exact weeks a form number covers.
 *
 * Carried on the response so the panel can name them instead of saying
 * "recently". The window used to be described only by the phrase "last 3 wks",
 * which stayed on screen while the query behind it silently read a different
 * season's opening weeks.
 */
export interface StatWindow {
  /** Season the weeks belong to — not always the season being played. */
  season:    number;
  /** First week of the window, inclusive. */
  startWeek: number;
  /** Last week of the window, inclusive. */
  endWeek:   number;
  /** True when `season` is not the season being played. */
  fallback:  boolean;
}

/**
 * Where one position on a roster sits against the rest of the league.
 *
 * Reported for every position the league starts, ranked rather than flagged.
 * "More than 15% below the median" was the whole test and it flagged good
 * starters: when the top of a position pulls away from the middle, the median
 * rides up with it and a mid-table starter falls more than 15% short of a number
 * no mid-table roster is near. A rank survives that; a percentage does not.
 */
export interface PositionNeed {
  position: string;
  /** Starting slots the league gives this position, which `mine` is measured over. */
  slots:    number;
  /** My starting group's points per game across the window. */
  mine:     number;
  /** League median of the same figure. */
  median:   number;
  /** 1 = best in the league. Ties share the better rank. */
  rank:     number;
  /** Rosters compared — the league size. */
  of:       number;
  /** Games behind `mine`. 0 means nothing was measured, not that I scored zero. */
  games:    number;
  /**
   * Bottom third of the league *and* more than 15% below the median.
   *
   * Both, because either alone is wrong: a rank alone calls someone weak in a
   * league where every roster is within a point, and a percentage alone calls a
   * mid-table starter weak at a position that happens to be tightly packed.
   */
  weak:     boolean;
  /**
   * No player in my group has a game in the window.
   *
   * A hole in the data — an unsynced week, a name the stat table files
   * differently — not a hole in the roster, and never counted weak. Reported so
   * a zero on the panel can be read as "not measured" rather than "scored none".
   */
  unmeasured: boolean;
}

export interface WaiverSuggestion {
  playerId:      string;
  name:          string;
  position:      string;
  team:          string | null;
  headshot:      string | null;  // NFL CDN URL from DB; null when player has no DB stats yet
  /**
   * Points per game across the games actually played inside the window.
   *
   * Games played, not weeks elapsed: a bye or an inactive week is absent from
   * the average rather than scored as a zero. `games` says how many are behind
   * it, which is the difference between "12.0 a week" and "12.0, once".
   */
  recentAvg:     number;
  /** Games behind `recentAvg`, inside the window. 0 means the player did not play. */
  games:         number;
  /**
   * The projection band, by the same method the matchup report uses — the
   * blended mean +/- 1.28 sigma, read at roughly the 10th and 90th percentiles,
   * with the floor clamped at zero. See src/lib/projection.ts.
   *
   * Centred on the blended mean, not on `recentAvg`: a player with one game is
   * shrunk toward what his position typically does, so the band is wide enough
   * to say the average beside it rests on one number. The two can therefore
   * disagree, and the panel labels them separately.
   */
  floor:         number;
  ceiling:       number;
  /** Centre of the band above. Differs from `recentAvg` on a thin sample. */
  projected:     number;
  /**
   * Fixture, opposing unit, forecast and betting line for the week ahead.
   *
   * Read-only context, identical to the matchup report's. Nothing here feeds
   * any number above it — see src/lib/matchupContext.ts.
   */
  context:       PlayerContext;
  reason:        string;
  trendingCount: number | null;
}

export interface WaiverSuggestionsResponse {
  /** Positions that are genuinely weak — the subset of `positionNeeds` with `weak`. */
  weakPositions: string[];
  /**
   * Every position the league starts, worst first.
   *
   * The panel shows the top few as a needs ladder rather than a single flag, so
   * a roster with no position past the weakness bar still gets an answer to
   * "where am I thinnest".
   */
  positionNeeds: PositionNeed[];
  /**
   * Starting slots per position in this league, which is what `weakPositions`
   * was measured over — two RB slots means the RB comparison ran over each
   * roster's top two, not its best one. See src/lib/sleeper/lineup.ts.
   */
  starterSlots:  Record<string, number>;
  /**
   * Free agents actually considered — every un-rostered player at a scored
   * position with a game in the window, plus the trending names the window
   * cannot speak for yet.
   *
   * Reported because the panel shows eight of them and the number behind those
   * eight is the difference between a ranked shortlist and the top of somebody
   * else's popularity list.
   */
  scanned:       number;
  suggestions:   WaiverSuggestion[];
  /** The weeks every average and band on this response covers. */
  window:        StatWindow;
  /** The NFL week the context cards describe — the one a claim would be for. */
  week:          number;
  /** Season the underlying stats came from — see src/lib/statsSeason.ts. */
  statsSeason?:   number;
  /** True when statsSeason is not the season being played (pre-kickoff, sync lag). */
  statsFallback?: boolean;
}

export interface TradePlayer {
  playerId:        string;
  /** Sleeper numeric ID — use for CDN headshots. Equals playerId in live mode. */
  sleeperPlayerId: string;
  name:            string;
  position:        string;
  seasonPts:       number;
  /**
   * Where he sits on his own roster's depth chart at this position, 1 = best.
   *
   * This is the answer to "why him?". A proposal that moves an RB3 is moving
   * depth the roster does not start; one that moves an RB1 is moving the
   * roster's strength, and the panel should not show the two the same way.
   */
  depthRank:       number;
  /** Inside his roster's starting slots at this position. */
  starter:         boolean;
}

export interface TradeProposal {
  targetTeamName: string;
  targetOwnerId:  string;
  give:           TradePlayer[];
  receive:        TradePlayer[];
  fairnessScore:  number;
  /**
   * Season points this adds to my starting lineup — the whole point of the
   * deal, and always positive: proposals that leave the lineup flat or worse
   * are not returned. Not the same as the points differential, which counts
   * bench players the lineup never fields.
   */
  lineupGain:      number;
  /** The same figure for the other roster — why they would accept. */
  theirLineupGain: number;
  summary:        string;
}

export interface TradeSuggestionsResponse {
  myPositionRanks: Record<string, number>;
  /**
   * Starting slots per position in this league — the line every depthRank and
   * `starter` flag on this response was drawn against. See
   * src/lib/sleeper/lineup.ts.
   */
  starterSlots:    Record<string, number>;
  proposals:       TradeProposal[];
  /** Season the underlying stats came from — see src/lib/statsSeason.ts. */
  statsSeason?:   number;
  /** True when statsSeason is not the season being played (pre-kickoff, sync lag). */
  statsFallback?: boolean;
}
