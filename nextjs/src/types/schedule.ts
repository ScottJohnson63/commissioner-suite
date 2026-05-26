export interface DbLeague {
  id:              string;
  sleeperLeagueId: string;
  name:            string;
  season:          number;
}

export interface AssocTeam {
  id:              string;
  name:            string;
  divisionId:      number;
  sleeperRosterId: string;
}

export interface MatchupWithTeams {
  id:         string;
  week:       number;
  type:       string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam:   AssocTeam;
  awayTeam:   AssocTeam;
}

export interface AssocSchedule {
  id:          string;
  season:      number;
  generatedAt: string;
  league:      { id: string; sleeperLeagueId: string };
  matchups:    MatchupWithTeams[];
}
