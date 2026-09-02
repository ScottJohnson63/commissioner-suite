// tests/unit/lib/matchupContext.test.ts
//
// Covers src/lib/matchupContext.ts — the fixture, opposing unit, forecast and
// betting line shown beside a projection.
//
// The load-bearing property is that none of it feeds the projection. It exists
// because the app had no fixture source: weather guessed at each player's own
// home stadium, the opponent-defense lookup was removed for want of an opponent,
// and the Vegas lines were whichever three games came first on the slate.

import { describe, it, expect } from '@jest/globals';
import {
  buildPlayerContext, unitStrengths, venueOf, type Fixture, type UnitStrength,
} from '@/lib/matchupContext';
import type { WeatherInfo, VegasLine } from '@/types/projections';

const GAME: Fixture = {
  homeTeam: 'BUF', awayTeam: 'BAL',
  kickoff: '2026-09-13T13:00', stadium: 'Highmark Stadium',
  roof: 'outdoors', location: 'Home',
};

const fixtures = new Map<string, Fixture>([['BUF', GAME], ['BAL', GAME]]);

const forecast: WeatherInfo = {
  team: 'BUF', tempF: 34, windMph: 26, precipPct: 70,
  stadiumName: 'Highmark Stadium', note: 'High wind',
};

const line: VegasLine = {
  homeTeam: 'Buffalo Bills', awayTeam: 'Baltimore Ravens', total: 47.5, spread: -2.5,
};

const strength = (over: Partial<UnitStrength> = {}): UnitStrength =>
  ({ team: 'BAL', rank: 3, of: 32, perGame: 9.1, tier: 'elite', ...over });

describe('buildPlayerContext()', () => {
  it('names the opponent and which side of the fixture the player is on', () => {
    const home = buildPlayerContext('BUF', 'WR', fixtures, new Map(), new Map(), new Map());
    expect(home.opponent).toBe('BAL');
    expect(home.home).toBe(true);

    const away = buildPlayerContext('BAL', 'WR', fixtures, new Map(), new Map(), new Map());
    expect(away.opponent).toBe('BUF');
    expect(away.home).toBe(false);
  });

  // WHY: the whole point of the fixture table. Weather used to be read at each
  //      player's own home ground, so a player on the road got the forecast for
  //      a city he was not in.
  it('reads the forecast at the venue, for both teams in the game', () => {
    const weather = new Map([['BUF', forecast]]);
    for (const team of ['BUF', 'BAL']) {
      const ctx = buildPlayerContext(team, 'WR', fixtures, new Map(), weather, new Map());
      expect(ctx.weather?.stadiumName).toBe('Highmark Stadium');
    }
  });

  // WHY: a roof makes the forecast irrelevant rather than unavailable, and the
  //      two should not read the same to someone deciding a lineup.
  it('says a game is indoors rather than reporting no forecast', () => {
    const domed = new Map<string, Fixture>([
      ['DET', { ...GAME, homeTeam: 'DET', awayTeam: 'CHI', roof: 'dome', stadium: 'Ford Field' }],
    ]);
    const ctx = buildPlayerContext('DET', 'WR', domed, new Map(), new Map(), new Map());
    expect(ctx.weather).toBeNull();
    expect(ctx.weatherNote).toContain('Indoors');
  });

  // WHY: nflverse leaves `roof` null on some fixtures until closer to kickoff —
  //      two of week 1's sixteen in 2026. The stadium table already knows which
  //      grounds are covered, and "no forecast" would invite the reader to
  //      wonder about weather that cannot matter.
  it('treats a known dome as indoors when the fixture has no roof set', () => {
    const unset = new Map<string, Fixture>([
      ['IND', { ...GAME, homeTeam: 'IND', awayTeam: 'BAL', roof: null, stadium: 'Lucas Oil Stadium' }],
    ]);
    const ctx = buildPlayerContext('IND', 'WR', unset, new Map(), new Map(), new Map());
    expect(ctx.weatherNote).toContain('Indoors');
  });

  // WHY: an open-air ground with no roof recorded must not be mistaken for a
  //      dome — that would silently drop a real forecast.
  it('still expects a forecast at an open ground with no roof set', () => {
    const unset = new Map<string, Fixture>([
      ['BUF', { ...GAME, roof: null }],
    ]);
    const ctx = buildPlayerContext('BUF', 'WR', unset, new Map(), new Map([['BUF', forecast]]), new Map());
    expect(ctx.weather?.windMph).toBe(26);
  });

  // WHY: week 1 of 2026 has San Francisco at Los Angeles played in Melbourne.
  //      A neutral site is not automatically un-forecastable — the venue has
  //      coordinates of its own, and refusing on the label alone left every
  //      Rams player that week with no conditions at all.
  it('forecasts a neutral site whose venue can be placed', () => {
    const melbourne = new Map<string, Fixture>([
      ['LAR', { ...GAME, homeTeam: 'LAR', awayTeam: 'SF', location: 'Neutral', stadium: 'Melbourne Cricket Ground' }],
    ]);
    const ctx = buildPlayerContext('LAR', 'WR', melbourne, new Map(), new Map([['LAR', forecast]]), new Map());
    expect(ctx.weather?.windMph).toBe(26);
  });

  // WHY: a neutral game somewhere unrecognised is the one case with no answer.
  //      The nominal home team's ground is not where the game is being played,
  //      so its forecast would be confidently wrong.
  it('says so when a neutral venue cannot be placed', () => {
    const unknown = new Map<string, Fixture>([
      ['LAR', { ...GAME, homeTeam: 'LAR', awayTeam: 'SF', location: 'Neutral', stadium: 'Somewhere New' }],
    ]);
    const ctx = buildPlayerContext('LAR', 'WR', unknown, new Map(), new Map(), new Map());
    expect(ctx.weather).toBeNull();
    expect(ctx.weatherNote).toContain('Neutral site');
  });

  // WHY: nflverse spells the Rams LA in its schedules and LAR appears
  //      everywhere else. Unreconciled, every Rams player finds no fixture —
  //      no opponent, no forecast, no line — and it reads exactly like a bye.
  it('finds a fixture whose feed spells the team differently', () => {
    const raw = new Map<string, Fixture>([
      ['LAR', { ...GAME, homeTeam: 'LAR', awayTeam: 'SF' }],
    ]);
    expect(buildPlayerContext('LA', 'WR', raw, new Map(), new Map(), new Map()).opponent).toBe('SF');
    expect(buildPlayerContext('LAR', 'WR', raw, new Map(), new Map(), new Map()).opponent).toBe('SF');
  });

  // WHY: the direction is not symmetric and is the thing most easily got
  //      backwards. An offensive player is judged against the defense he faces;
  //      a defense against the offense it faces.
  it('faces an offensive player at the opposing defense', () => {
    const strengths = new Map([['BAL|WR', strength()]]);
    const ctx = buildPlayerContext('BUF', 'WR', fixtures, strengths, new Map(), new Map());
    expect(ctx.opposing?.team).toBe('BAL');
    expect(ctx.opposing?.tier).toBe('elite');
  });

  it('faces a defense at the opposing offense', () => {
    const strengths = new Map([
      ['BAL|DEF', strength({ team: 'BAL', tier: 'soft' })],   // must not be used
      ['OFF|BAL', strength({ team: 'BAL', tier: 'strong' })],
    ]);
    const ctx = buildPlayerContext('BUF', 'DEF', fixtures, strengths, new Map(), new Map());
    expect(ctx.opposing?.tier).toBe('strong');
  });

  // WHY: lines arrive named in full and everything else here is abbreviated, so
  //      a game is only findable once the two are bridged.
  it('attaches the line for this game to both teams', () => {
    const lines = new Map([['BUF|BAL', line]]);
    expect(buildPlayerContext('BUF', 'WR', fixtures, new Map(), new Map(), lines).line?.total).toBe(47.5);
    expect(buildPlayerContext('BAL', 'WR', fixtures, new Map(), new Map(), lines).line?.total).toBe(47.5);
  });

  // WHY: the odds feed returns the whole season at once, and divisional rivals
  //      meet twice. A line keyed on one team would attach the wrong meeting.
  it('does not take a line from the reverse fixture', () => {
    const reverse = new Map([['BAL|BUF', { ...line, total: 99 }]]);
    expect(buildPlayerContext('BUF', 'WR', fixtures, new Map(), new Map(), reverse).line).toBeNull();
  });

  // WHY: a bye week, or a schedule that has not synced, is a real state. It has
  //      to read as an absence rather than throwing or inventing a fixture.
  it('degrades when the player has no game anywhere', () => {
    const ctx = buildPlayerContext('NYJ', 'WR', fixtures, new Map(), new Map(), new Map());
    expect(ctx.opponent).toBeNull();
    expect(ctx.opposing).toBeNull();
    expect(ctx.line).toBeNull();
    expect(ctx.weatherNote).toContain('No fixture');
  });

  // WHY: a schedule gap should cost the venue, not the whole card. The betting
  //      lines carry their own pairings, so the opponent — and therefore the
  //      defense lookup and the line itself — survive without one.
  it('recovers the opponent from the betting line when the schedule has none', () => {
    const lines = new Map([['DEN|NYJ', line]]);
    const strengths = new Map([['DEN|WR', strength({ team: 'DEN', tier: 'elite' })]]);
    const ctx = buildPlayerContext('NYJ', 'WR', new Map(), strengths, new Map(), lines);

    expect(ctx.opponent).toBe('DEN');
    expect(ctx.home).toBe(false);
    expect(ctx.opposing?.tier).toBe('elite');
    expect(ctx.line?.total).toBe(47.5);
    expect(ctx.weatherNote).toContain('Venue unknown');
  });

  it('reads the home side correctly from a recovered fixture', () => {
    const lines = new Map([['DEN|NYJ', line]]);
    const ctx = buildPlayerContext('DEN', 'WR', new Map(), new Map(), new Map(), lines);
    expect(ctx.opponent).toBe('NYJ');
    expect(ctx.home).toBe(true);
  });

  it('degrades when the player has no team', () => {
    const ctx = buildPlayerContext(null, 'WR', fixtures, new Map(), new Map(), new Map());
    expect(ctx.opponent).toBeNull();
  });

  it('falls back to a whole-defense figure when the position has none', () => {
    const strengths = new Map([['BAL', strength({ tier: 'average' })]]);
    const ctx = buildPlayerContext('BUF', 'K', fixtures, strengths, new Map(), new Map());
    expect(ctx.opposing?.tier).toBe('average');
  });
});

describe('unitStrengths()', () => {
  /** One weekly line: `team` scored `points` against `opponentTeam`. */
  const line = (
    week: number, team: string, opponentTeam: string, position: string, points: number,
  ) => ({ week, team, opponentTeam, position, points });

  const score = (r: { points: number }) => r.points;

  // WHY: rank 1 is the best defense, which is the one that conceded least. The
  //      direction is the thing a reader acts on and the easiest to invert.
  it('ranks the stingiest defense first', () => {
    const rows = [
      line(1, 'BUF', 'BAL', 'WR', 4),    // BAL conceded 4
      line(1, 'KC',  'NYJ', 'WR', 30),   // NYJ conceded 30
    ];
    const s = unitStrengths(rows, score);
    expect(s.get('BAL|WR')?.rank).toBe(1);
    expect(s.get('NYJ|WR')?.rank).toBe(2);
    expect(s.get('BAL|WR')!.perGame).toBeLessThan(s.get('NYJ|WR')!.perGame);
  });

  // WHY: the tier is a share of the league, not an absolute rank, so it only
  //      means anything against a full field. Four defenses put one team in each
  //      quartile.
  it('names each quartile of the field', () => {
    const rows = ['BAL', 'NYJ', 'MIA', 'NE'].map((def, i) =>
      line(1, 'BUF', def, 'WR', (i + 1) * 10),
    );
    const s = unitStrengths(rows, score);
    expect(s.get('BAL|WR')?.tier).toBe('elite');     // conceded least
    expect(s.get('NYJ|WR')?.tier).toBe('strong');
    expect(s.get('MIA|WR')?.tier).toBe('average');
    expect(s.get('NE|WR')?.tier).toBe('soft');       // conceded most
  });

  // WHY: a defense that played more weeks would otherwise look worse purely for
  //      having conceded more times.
  it('compares per game, not per total', () => {
    const rows = [
      line(1, 'BUF', 'BAL', 'WR', 10),
      line(2, 'BUF', 'BAL', 'WR', 10),   // BAL: 20 over two weeks = 10/gm
      line(1, 'KC',  'NYJ', 'WR', 15),   // NYJ: 15 over one week  = 15/gm
    ];
    const s = unitStrengths(rows, score);
    expect(s.get('BAL|WR')?.perGame).toBe(10);
    expect(s.get('NYJ|WR')?.perGame).toBe(15);
    expect(s.get('BAL|WR')!.rank).toBeLessThan(s.get('NYJ|WR')!.rank);
  });

  // WHY: a defense is judged against the offense it faces, so the same rows have
  //      to be read the other way round — and there, more is better.
  it('ranks the most productive offense first', () => {
    const rows = [
      line(1, 'BUF', 'BAL', 'WR', 30),
      line(1, 'NYJ', 'KC',  'WR', 4),
    ];
    const s = unitStrengths(rows, score);
    expect(s.get('OFF|BUF')?.rank).toBe(1);
    expect(s.get('OFF|NYJ')?.rank).toBe(2);
  });

  // WHY: nobody concedes points to a defense. Counting DEF rows as something a
  //      defense allowed would put every team's own defensive output into the
  //      table it is being measured against.
  it('ignores defense rows when measuring what defenses concede', () => {
    const rows = [
      line(1, 'BUF', 'BAL', 'DEF', 25),
      line(1, 'BUF', 'BAL', 'WR',  5),
    ];
    const s = unitStrengths(rows, score);
    expect(s.get('BAL|DEF')).toBeUndefined();
    expect(s.get('BAL')?.perGame).toBe(5);
  });

  // WHY: the scorer is passed in because a kicker's points live in columns a
  //      narrow select leaves out — scoring one at zero made the K row of this
  //      table meaningless, every defense tied at 0/gm.
  it('scores rows through the caller supplied scorer', () => {
    const rows = [line(1, 'BUF', 'BAL', 'K', 9)];
    expect(unitStrengths(rows, score).get('BAL|K')?.perGame).toBe(9);
    expect(unitStrengths(rows, () => 0).get('BAL|K')?.perGame).toBe(0);
  });
});

describe('venueOf()', () => {
  // WHY: this is where the team → ground lookup went when getWeather stopped
  //      taking a team. Everything downstream of a wrong answer here is a
  //      forecast for the wrong city.
  it('uses the home ground for an ordinary fixture', () => {
    expect(venueOf(GAME)?.name).toBe('Highmark Stadium');
  });

  it('uses the named venue for an international game', () => {
    const melbourne: Fixture = {
      ...GAME, homeTeam: 'LAR', awayTeam: 'SF',
      location: 'Neutral', stadium: 'Melbourne Cricket Ground',
    };
    expect(venueOf(melbourne)?.name).toBe('Melbourne Cricket Ground');
  });

  // WHY: a neutral game is usually just an NFL ground hosting an extra fixture —
  //      Minnesota at Pittsburgh is still Acrisure, and its coordinates are right.
  it('uses the home ground for a neutral game played at that ground', () => {
    const atHome: Fixture = { ...GAME, location: 'Neutral', stadium: 'Highmark Stadium' };
    expect(venueOf(atHome)?.name).toBe('Highmark Stadium');
  });

  // WHY: the nominal home team's ground is not where this game is. A confident
  //      forecast for it would be confidently wrong.
  it('refuses a neutral game at an unrecognised venue', () => {
    const elsewhere: Fixture = { ...GAME, location: 'Neutral', stadium: 'Somewhere New' };
    expect(venueOf(elsewhere)).toBeNull();
  });

  // WHY: an unknown team code used to be handled inside the weather helper,
  //      which returned null rather than throwing on the undefined entry.
  it('returns null for a team with no ground on record', () => {
    expect(venueOf({ ...GAME, homeTeam: 'XYZ' })).toBeNull();
  });
});

