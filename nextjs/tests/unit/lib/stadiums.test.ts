// tests/unit/lib/stadiums.test.ts
//
// Tests for the STADIUM_COORDS constant in src/lib/stadiums.ts.
// This is a pure data module — no runtime branches, only invariant checks.

import { describe, it, expect } from '@jest/globals';
import { STADIUM_COORDS } from '@/lib/stadiums';

// The 32 current NFL team abbreviations we expect to find in the constant.
const ALL_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB',  'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV',  'MIA', 'MIN', 'NE',  'NO',  'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF',  'TB',  'TEN', 'WAS',
];

// Teams that play in climate-controlled domes (indoor or retractable roof stadiums
// that are closed for most games). This list is used by the weather module to skip
// the API call for teams where outdoor conditions are irrelevant.
const DOME_TEAMS = ['ARI', 'ATL', 'DAL', 'DET', 'HOU', 'IND', 'LAC', 'LAR', 'LV', 'MIN', 'NO'];

// A sample of outdoor stadiums used to verify dome: false is set correctly.
const OUTDOOR_TEAMS = ['BAL', 'BUF', 'GB', 'CHI', 'NE', 'PIT'];

describe('STADIUM_COORDS', () => {
  // WHY: If any team is missing, the weather and weather-enrichment code will
  //      silently return null for that team's games, causing blank weather data.
  it('contains an entry for all 32 NFL teams', () => {
    for (const team of ALL_TEAMS) {
      expect(STADIUM_COORDS).toHaveProperty(team);
    }
  });

  // WHY: Exactly 32 entries ensures no team is duplicated and none are extra.
  //      Object.keys length is the fastest dedup check.
  it('has exactly 32 entries (no duplicates, no extras)', () => {
    expect(Object.keys(STADIUM_COORDS)).toHaveLength(32);
  });

  // WHY: Dome stadiums must be flagged dome: true so getWeather() returns null
  //      without making an HTTP call — weather is irrelevant for covered games.
  it('marks all known dome stadiums with dome: true', () => {
    for (const team of DOME_TEAMS) {
      expect(STADIUM_COORDS[team].dome).toBe(true);
    }
  });

  // WHY: Outdoor stadiums must have dome: false so weather lookups are performed.
  //      A false-positive dome flag would silently suppress weather data.
  it('marks outdoor stadiums with dome: false', () => {
    for (const team of OUTDOOR_TEAMS) {
      expect(STADIUM_COORDS[team].dome).toBe(false);
    }
  });

  // WHY: Continental US latitudes run roughly 25°–49°N. Out-of-range values
  //      would produce obviously wrong Open-Meteo forecasts.
  it('has plausible latitude values (25°–50° N) for all teams', () => {
    for (const [team, stadium] of Object.entries(STADIUM_COORDS)) {
      expect(stadium.lat).toBeGreaterThanOrEqual(25);
      expect(stadium.lat).toBeLessThanOrEqual(50);
    }
  });

  // WHY: Continental US longitudes run roughly -60° to -130°W. Out-of-range
  //      values would silently produce incorrect weather forecasts.
  it('has plausible longitude values (−130° to −60°) for all teams', () => {
    for (const [team, stadium] of Object.entries(STADIUM_COORDS)) {
      expect(stadium.lon).toBeGreaterThanOrEqual(-130);
      expect(stadium.lon).toBeLessThanOrEqual(-60);
    }
  });

  // WHY: Each stadium entry must have a non-empty name string for display in
  //      the matchup report UI.
  it('has a non-empty name string for every stadium', () => {
    for (const [team, stadium] of Object.entries(STADIUM_COORDS)) {
      expect(typeof stadium.name).toBe('string');
      expect(stadium.name.length).toBeGreaterThan(0);
    }
  });
});
