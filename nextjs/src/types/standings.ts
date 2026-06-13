export interface StandingEntry {
  rank:       number;
  rosterId:   number;
  name:       string;
  ownerName:  string | null;
  isChampion: boolean;
  division:   1 | 2;
  winPct?:    number;  // present when divisions are seeded from all-time rankings
}

export interface StandingsResponse {
  standings:        StandingEntry[];
  rankedByAllTime:  boolean;  // true when cached all-time win% was used to seed divisions
}
