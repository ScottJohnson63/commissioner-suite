export interface StandingEntry {
  rank:      number;
  rosterId:  number;
  name:      string;
  ownerName: string | null;
  isChampion: boolean;
  division:  1 | 2;
}

export interface StandingsResponse {
  standings: StandingEntry[];
}
