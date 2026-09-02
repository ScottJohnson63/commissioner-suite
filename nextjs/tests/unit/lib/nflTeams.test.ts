// tests/unit/lib/nflTeams.test.ts
//
// Covers src/lib/nflTeams.ts — bridging the odds API's full team names to the
// abbreviations every other feed uses. Without it a betting line cannot be
// matched to a game, which is why the lines were rendered unfiltered.

import { describe, it, expect } from '@jest/globals';
import { abbrOf, NFL_TEAM_NAMES } from '@/lib/nflTeams';

describe('abbrOf()', () => {
  it('resolves the full names the odds API uses', () => {
    expect(abbrOf('Seattle Seahawks')).toBe('SEA');
    expect(abbrOf('San Francisco 49ers')).toBe('SF');
    expect(abbrOf('Washington Commanders')).toBe('WAS');
  });

  it('ignores case and surrounding space', () => {
    expect(abbrOf('  kansas city chiefs ')).toBe('KC');
  });

  // WHY: feeds disagree about city names far more than about nicknames.
  it('falls back to the nickname when the city is written differently', () => {
    expect(abbrOf('LA Chargers')).toBe('LAC');
    expect(abbrOf('New York Giants')).toBe('NYG');
  });

  // WHY: a feed still using a retired name has neither the right full name nor
  //      the right nickname, but the city is unambiguous for most teams.
  it('falls back to a city that names exactly one team', () => {
    expect(abbrOf('Washington Football Team')).toBe('WAS');
    expect(abbrOf('Cleveland Something')).toBe('CLE');
  });

  // WHY: two teams share New York and two share Los Angeles. Picking either
  //      would attach one game's line to another game entirely.
  it('refuses a city that names two teams', () => {
    expect(abbrOf('New York Whatevers')).toBeNull();
    expect(abbrOf('Los Angeles Whatevers')).toBeNull();
  });

  // WHY: both LA and LAR appear in nflverse for the Rams. The fixtures carry
  //      LAR, so a line matched to LA would never find its game.
  it('resolves the Rams to the abbreviation the fixtures use', () => {
    expect(abbrOf('Los Angeles Rams')).toBe('LAR');
  });

  // WHY: guessing would attach one game's line to another. Null is the honest
  //      answer and the dialog says "no line for this game".
  it('returns null rather than guessing', () => {
    expect(abbrOf('Toronto Argonauts')).toBeNull();
    expect(abbrOf('')).toBeNull();
    expect(abbrOf(null)).toBeNull();
    expect(abbrOf(undefined)).toBeNull();
  });

  it('round-trips every current team', () => {
    for (const [abbr, name] of Object.entries(NFL_TEAM_NAMES)) {
      if (abbr === 'LA') continue;   // duplicate of LAR by design
      expect(abbrOf(name)).toBe(abbr);
    }
  });
});
