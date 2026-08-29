/** A selectable team from the connected Sleeper league. */
export interface SleeperLeagueTeam {
  rosterId:  number;
  name:      string;
  ownerName: string | null;
}

/** A team row in the entry editor. List order is the final standings rank. */
export interface LotteryTeam {
  /** Stable row identity, independent of the Sleeper roster. */
  id:        number;
  /** Sleeper roster ID, or 0 when the row was typed in by hand. */
  rosterId:  number;
  name:      string;
  ownerName: string;
}

export interface LotteryResult {
  rosterId:  number;
  name:      string;
  ownerName: string | null;
  prevRank:  number;
  count:     number;
  pick:      number;
}

export interface DraftPick {
  pick:      number;
  rosterId:  number;
  name:      string;
  ownerName: string | null;
  source:    'lottery' | 'standings';
  prevRank:  number;
}
