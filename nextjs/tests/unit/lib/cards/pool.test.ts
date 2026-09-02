// tests/unit/lib/cards/pool.test.ts
//
// Covers the ranking rule in src/lib/cards/pool.ts.
//
// rankSeason is the whole tiering decision in one function: it is what makes
// the top five *of each position* Hall of Fame rather than the top five overall.
// That distinction is the difference between a game where kickers and defenses
// have cards worth chasing and one where they are permanently Bronze, so it is
// pinned here with a fixture rather than left to the pool builder's integration
// with the database.

import { describe, it, expect } from '@jest/globals';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { rankSeason, MIN_GAMES_FOR_TIER } from '@/lib/cards/pool';

interface Fixture {
  playerId: string; playerName: string; position: string;
  team: string | null; fantasyPoints: number; gamesPlayed: number;
  headshot: string | null;
}

/** `count` players at `position`, descending from `top` points over 17 games. */
function players(position: string, count: number, top = 400): Fixture[] {
  return Array.from({ length: count }, (_, i) => ({
    playerId:   `${position}-${i + 1}`,
    playerName: `${position} Player ${i + 1}`,
    position,
    team:       'ATL',
    headshot:   null,
    gamesPlayed: 17,
    fantasyPoints: top - i,
  }));
}

/** One player with an explicit average and games count. */
function player(
  id: string, position: string, perGame: number, games: number,
): Fixture {
  return {
    playerId: id, playerName: id, position, team: null, headshot: null,
    gamesPlayed: games, fantasyPoints: perGame * games,
  };
}

describe('rankSeason()', () => {
  // WHY: the core of the per-position rule. Tight ends score a fraction of
  //      what running backs do, so on one combined leaderboard no tight end
  //      would ever reach a top-five cut — TE1 must still be Hall of Fame.
  it('tiers each position on its own leaderboard', () => {
    const ranked = rankSeason(
      [...players('RB', 25, 400), ...players('TE', 25, 170)],
      2025,
    );

    const te1 = ranked.find((c) => c.playerId === 'TE-1')!;
    const rb1 = ranked.find((c) => c.playerId === 'RB-1')!;

    expect(te1.tier).toBe('HALL_OF_FAME');
    expect(rb1.tier).toBe('HALL_OF_FAME');
    // Despite TE1 scoring less than every one of the 25 running backs.
    expect(te1.fantasyPoints).toBeLessThan(ranked.find((c) => c.playerId === 'RB-25')!.fantasyPoints);
  });

  it('numbers each position from 1', () => {
    const ranked = rankSeason([...players('QB', 3), ...players('WR', 3)], 2025);
    const ranks = (pos: string) =>
      ranked.filter((c) => c.position === pos).map((c) => c.seasonRank).sort();
    expect(ranks('QB')).toEqual([1, 2, 3]);
    expect(ranks('WR')).toEqual([1, 2, 3]);
  });

  // WHY: the cutoffs applied per position — 5 HOF, 5 Gold, 20 Silver, rest
  //      Bronze — which is what produces 540 / 540 / 2,160 across four
  //      positions and twenty-seven seasons. Silver's twenty ranks are what
  //      keep Bronze to 76% of the pool rather than 84%.
  it('applies the 5 / 5 / 20 split within a position', () => {
    const ranked = rankSeason(players('WR', 40), 2025);
    const count = (tier: string) => ranked.filter((c) => c.tier === tier).length;

    expect(count('HALL_OF_FAME')).toBe(5);
    expect(count('GOLD')).toBe(5);
    expect(count('SILVER')).toBe(20);
    expect(count('BRONZE')).toBe(10);
  });

  it('ranks by points, not by input order', () => {
    const shuffled = [
      { playerId: 'c', playerName: 'C', position: 'TE', team: null, headshot: null, gamesPlayed: 17, fantasyPoints: 100 },
      { playerId: 'a', playerName: 'A', position: 'TE', team: null, headshot: null, gamesPlayed: 17, fantasyPoints: 300 },
      { playerId: 'b', playerName: 'B', position: 'TE', team: null, headshot: null, gamesPlayed: 17, fantasyPoints: 200 },
    ];
    const ranked = rankSeason(shuffled, 2025).sort((x, y) => x.seasonRank - y.seasonRank);
    expect(ranked.map((c) => c.playerId)).toEqual(['a', 'b', 'c']);
  });

  // WHY: a rebuild runs on every stat correction. If ties broke arbitrarily,
  //      two players on identical points could swap tiers between rebuilds and
  //      a member's Hall of Fame card would quietly become Gold.
  it('breaks ties deterministically', () => {
    const tied = [
      { playerId: 'zz', playerName: 'Z', position: 'RB', team: null, headshot: null, gamesPlayed: 17, fantasyPoints: 200 },
      { playerId: 'aa', playerName: 'A', position: 'RB', team: null, headshot: null, gamesPlayed: 17, fantasyPoints: 200 },
    ];
    const first = rankSeason(tied, 2025);
    const again = rankSeason([...tied].reverse(), 2025);
    expect(first.find((c) => c.playerId === 'aa')!.seasonRank)
      .toBe(again.find((c) => c.playerId === 'aa')!.seasonRank);
  });

  it('stamps the season onto every card', () => {
    const ranked = rankSeason(players('QB', 4), 2019);
    expect(ranked.every((c) => c.season === 2019)).toBe(true);
  });

  it('handles a position with fewer players than the cutoffs', () => {
    const ranked = rankSeason(players('TE', 3), 2025);
    expect(ranked).toHaveLength(3);
    expect(ranked.every((c) => c.tier === 'HALL_OF_FAME')).toBe(true);
  });

  it('returns nothing for no players', () => {
    expect(rankSeason([], 2025)).toEqual([]);
  });
});

describe('rankSeason() — points per game and the games floor', () => {
  // WHY: the tier is set by the average, and the card face prints that same
  //      average. Ranking on the season total instead put a Gold card above a
  //      Hall of Fame one on its own headline number.
  it('ranks by average, not by season total', () => {
    const ranked = rankSeason(
      [
        // Fewer total points, better per game — and enough games to qualify.
        player('efficient', 'RB', 20, 10),   // 200 total
        player('compiler',  'RB', 15, 17),   // 255 total
      ],
      2025,
    );

    const efficient = ranked.find((c) => c.playerId === 'efficient')!;
    const compiler = ranked.find((c) => c.playerId === 'compiler')!;

    expect(efficient.seasonRank).toBe(1);
    expect(compiler.seasonRank).toBe(2);
    expect(efficient.fantasyPoints).toBeLessThan(compiler.fantasyPoints);
  });

  // WHY: the floor is the whole reason per-game ranking is safe. Without it a
  //      single big afternoon outranks a full season.
  it('ranks anyone short of the games floor below everyone who met it', () => {
    const ranked = rankSeason(
      [
        player('fluke',   'WR', 40, MIN_GAMES_FOR_TIER - 1), // huge average, too few games
        player('starter', 'WR', 12, 17),
      ],
      2025,
    );

    expect(ranked.find((c) => c.playerId === 'starter')!.seasonRank).toBe(1);
    expect(ranked.find((c) => c.playerId === 'fluke')!.seasonRank).toBe(2);
  });

  it('lets a player who played exactly the minimum qualify', () => {
    const ranked = rankSeason(
      [
        player('injured', 'RB', 25, MIN_GAMES_FOR_TIER),
        player('healthy', 'RB', 18, 17),
      ],
      2025,
    );
    expect(ranked.find((c) => c.playerId === 'injured')!.seasonRank).toBe(1);
  });

  // WHY: an unqualified player keeps a card — they played — but must not be
  //      able to reach a rare tier however good their average was.
  it('keeps unqualified players in the pool, ordered among themselves', () => {
    const short = [
      player('short-a', 'TE', 30, 3),
      player('short-b', 'TE', 20, 3),
    ];
    // Thirty qualified players ahead of them, so the two short seasons land at
    // ranks 31 and 32 — past TIER_MAX_RANK.SILVER, which is what makes this a
    // test of the games floor rather than of where the Silver cutoff happens
    // to sit.
    const ranked = rankSeason([...players('TE', 30, 340), ...short], 2025);

    expect(ranked).toHaveLength(32);
    // Both sit past the Silver cutoff, so both are Bronze.
    for (const id of ['short-a', 'short-b']) {
      expect(ranked.find((c) => c.playerId === id)!.tier).toBe('BRONZE');
    }
    // And the better average of the two still comes first.
    expect(ranked.find((c) => c.playerId === 'short-a')!.seasonRank)
      .toBeLessThan(ranked.find((c) => c.playerId === 'short-b')!.seasonRank);
  });

  it('treats a player with no games as scoring nothing rather than dividing by zero', () => {
    const ranked = rankSeason([player('ghost', 'QB', 0, 0), player('real', 'QB', 18, 17)], 2025);
    expect(ranked.find((c) => c.playerId === 'ghost')!.seasonRank).toBe(2);
    expect(Number.isNaN(ranked.find((c) => c.playerId === 'ghost')!.fantasyPoints)).toBe(false);
  });
});
