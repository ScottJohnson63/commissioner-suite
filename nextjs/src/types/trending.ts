export interface TrendingPlayer {
  player_id: string;
  count:     number;
  type:      'add' | 'drop';
  name:      string | null;
  position:  string | null;
  team:      string | null;
}

export interface TrendingData {
  adds:  TrendingPlayer[];
  drops: TrendingPlayer[];
}
