export interface WaiverSuggestion {
  playerId:      string;
  name:          string;
  position:      string;
  team:          string | null;
  headshot:      string | null;  // NFL CDN URL from DB; null when player has no DB stats yet
  recentAvg:     number;
  reason:        string;
  trendingCount: number | null;
}

export interface WaiverSuggestionsResponse {
  weakPositions: string[];
  suggestions:   WaiverSuggestion[];
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
}

export interface TradeProposal {
  targetTeamName: string;
  targetOwnerId:  string;
  give:           TradePlayer[];
  receive:        TradePlayer[];
  fairnessScore:  number;
  summary:        string;
}

export interface TradeSuggestionsResponse {
  myPositionRanks: Record<string, number>;
  proposals:       TradeProposal[];
  /** Season the underlying stats came from — see src/lib/statsSeason.ts. */
  statsSeason?:   number;
  /** True when statsSeason is not the season being played (pre-kickoff, sync lag). */
  statsFallback?: boolean;
}
