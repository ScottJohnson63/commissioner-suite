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
