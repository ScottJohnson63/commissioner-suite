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
  defAdjustment:   number;
  weatherNote:     string | null;
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
  sport?:   string;
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
