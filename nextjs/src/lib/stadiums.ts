// src/lib/stadiums.ts — NFL stadium coordinates for weather lookups.

export interface Stadium {
  lat:  number;
  lon:  number;
  name: string;
  dome: boolean;
}

export const STADIUM_COORDS: Record<string, Stadium> = {
  ARI: { lat: 33.5277,  lon: -112.2626, name: 'State Farm Stadium',       dome: true  },
  ATL: { lat: 33.7554,  lon: -84.4009,  name: 'Mercedes-Benz Stadium',    dome: true  },
  BAL: { lat: 39.2780,  lon: -76.6227,  name: 'M&T Bank Stadium',         dome: false },
  BUF: { lat: 42.7738,  lon: -78.7870,  name: 'Highmark Stadium',         dome: false },
  CAR: { lat: 35.2258,  lon: -80.8528,  name: 'Bank of America Stadium',  dome: false },
  CHI: { lat: 41.8623,  lon: -87.6167,  name: 'Soldier Field',            dome: false },
  CIN: { lat: 39.0955,  lon: -84.5160,  name: 'Paycor Stadium',           dome: false },
  CLE: { lat: 41.5061,  lon: -81.6995,  name: 'Cleveland Browns Stadium', dome: false },
  DAL: { lat: 32.7473,  lon: -97.0945,  name: 'AT&T Stadium',             dome: true  },
  DEN: { lat: 39.7439,  lon: -105.0201, name: 'Empower Field',            dome: false },
  DET: { lat: 42.3400,  lon: -83.0456,  name: 'Ford Field',               dome: true  },
  GB:  { lat: 44.5013,  lon: -88.0622,  name: 'Lambeau Field',            dome: false },
  HOU: { lat: 29.6847,  lon: -95.4107,  name: 'NRG Stadium',              dome: true  },
  IND: { lat: 39.7601,  lon: -86.1639,  name: 'Lucas Oil Stadium',        dome: true  },
  JAX: { lat: 30.3239,  lon: -81.6373,  name: 'EverBank Stadium',         dome: false },
  KC:  { lat: 39.0489,  lon: -94.4839,  name: 'GEHA Field',               dome: false },
  LAC: { lat: 33.9535,  lon: -118.3392, name: 'SoFi Stadium',             dome: true  },
  LAR: { lat: 33.9535,  lon: -118.3392, name: 'SoFi Stadium',             dome: true  },
  LV:  { lat: 36.0909,  lon: -115.1833, name: 'Allegiant Stadium',        dome: true  },
  MIA: { lat: 25.9580,  lon: -80.2389,  name: 'Hard Rock Stadium',        dome: false },
  MIN: { lat: 44.9740,  lon: -93.2577,  name: 'U.S. Bank Stadium',        dome: true  },
  NE:  { lat: 42.0909,  lon: -71.2643,  name: 'Gillette Stadium',         dome: false },
  NO:  { lat: 29.9511,  lon: -90.0812,  name: 'Caesars Superdome',        dome: true  },
  NYG: { lat: 40.8135,  lon: -74.0745,  name: 'MetLife Stadium',          dome: false },
  NYJ: { lat: 40.8135,  lon: -74.0745,  name: 'MetLife Stadium',          dome: false },
  PHI: { lat: 39.9008,  lon: -75.1675,  name: 'Lincoln Financial Field',  dome: false },
  PIT: { lat: 40.4468,  lon: -80.0158,  name: 'Acrisure Stadium',         dome: false },
  SEA: { lat: 47.5952,  lon: -122.3316, name: 'Lumen Field',              dome: false },
  SF:  { lat: 37.4032,  lon: -121.9698, name: "Levi's Stadium",           dome: false },
  TB:  { lat: 27.9759,  lon: -82.5033,  name: 'Raymond James Stadium',    dome: false },
  TEN: { lat: 36.1665,  lon: -86.7713,  name: 'Nissan Stadium',           dome: false },
  WAS: { lat: 38.9079,  lon: -76.8645,  name: 'Northwest Stadium',        dome: false },
};
