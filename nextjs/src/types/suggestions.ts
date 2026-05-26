export interface WaiverSuggestion {
  playerId:      string;
  name:          string;
  position:      string;
  team:          string | null;
  recentAvg:     number;
  reason:        string;
  trendingCount: number | null;
}

export interface WaiverSuggestionsResponse {
  weakPositions: string[];
  suggestions:   WaiverSuggestion[];
  demo?:         boolean;
}

export interface TradePlayer {
  playerId:  string;
  name:      string;
  position:  string;
  seasonPts: number;
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
  demo?:           boolean;
}
