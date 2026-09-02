// tests/unit/lib/projection.test.ts
//
// Covers src/lib/projection.ts — blending what a player did with what his
// position typically does.
//
// The bug this replaces: `stdDev` returns 0 below two values, so a player with
// one game in the window projected floor = ceiling = mean. The least-known
// player on the panel carried the most confident number, and a player with no
// games read 0.0-0.0 — "will not score" rather than "we have nothing".

import { describe, it, expect } from '@jest/globals';
import {
  buildBaselines, project, type PositionBaseline,
} from '@/lib/projection';
import type { ScoringSettings } from '@/lib/scoring';
import type { StatLine } from '@/types/scoring';

const HALF_PPR: ScoringSettings = { rec: 0.5 };

/** A quarterback baseline in the shape 2025's closing weeks actually had. */
const QB: PositionBaseline = { mean: 14, sigma: 9, sample: 200 };

function rows(
  spec: Record<string, { position: string; points: number[] }>,
): (StatLine & { playerId: string })[] {
  return Object.entries(spec).flatMap(([playerId, { position, points }]) =>
    points.map((p) => ({
      playerId, position, fantasyPoints: p, receptions: 0,
    })),
  );
}

describe('project()', () => {
  // WHY: the reported bug. One game used to give a zero standard deviation and
  //      therefore a band of zero width.
  it('never reports a single game as a certainty', () => {
    const p = project([2.7], QB);
    expect(p.games).toBe(1);
    expect(p.sigma).toBeGreaterThan(5);
    // floor and ceiling are 1.28σ either side, so the band has real width
    expect(p.mean - 1.28 * p.sigma).toBeLessThan(p.mean);
    expect(p.mean + 1.28 * p.sigma).toBeGreaterThan(p.mean);
  });

  // WHY: no games is not the same claim as zero points. The old behaviour said
  //      a player would not score; the honest statement is that we know nothing
  //      and he will probably do what his position does.
  it('falls back to the positional baseline when nothing was observed', () => {
    const p = project([], QB);
    expect(p.games).toBe(0);
    expect(p.mean).toBeCloseTo(14, 5);
    expect(p.sigma).toBeGreaterThan(9);   // widened by not knowing the mean
  });

  // WHY: shrinkage has to fade out. A player with a real record should project
  //      as himself, not as his position.
  it('lets a full sample dominate the prior', () => {
    const observed = [20, 24, 18, 26, 22, 20];   // mean 21.67, well above QB 14
    const p = project(observed, QB);
    expect(p.mean).toBeGreaterThan(19.5);
    expect(p.games).toBe(6);
  });

  // WHY: the weight is the whole design. Six games and one game must not be
  //      treated alike, and the direction has to be monotone.
  it('weights the prior less as games accumulate', () => {
    const one  = project([2], QB);
    const four = project([2, 2, 2, 2], QB);
    const ten  = project(Array(10).fill(2), QB);

    expect(one.mean).toBeGreaterThan(four.mean);
    expect(four.mean).toBeGreaterThan(ten.mean);
    expect(one.sigma).toBeGreaterThan(ten.sigma);

    // At one game the estimate sits nearer the prior than the player; by ten it
    // has crossed over and sits nearer the player.
    const nearer = (m: number) => Math.abs(m - 2) < Math.abs(m - QB.mean);
    expect(nearer(one.mean)).toBe(false);
    expect(nearer(ten.mean)).toBe(true);
  });

  // WHY: a consistent player should still read as consistent. Shrinkage widens a
  //      thin sample; it must not flatten a thick one.
  it('keeps a steady player narrower than a volatile one', () => {
    const steady   = project([12, 12, 13, 12, 13, 12], QB);
    const volatile = project([2, 28, 4, 26, 3, 30], QB);
    expect(steady.sigma).toBeLessThan(volatile.sigma);
  });

  // WHY: a position with no baseline — an unusual slot, or an empty window —
  //      must not throw. Degrading to the plain mean and spread is what the
  //      route did before, so nothing gets worse.
  it('degrades to the plain mean and spread without a baseline', () => {
    expect(project([10, 20], undefined)).toEqual({ mean: 15, sigma: 5, games: 2 });
    expect(project([], undefined)).toEqual({ mean: 0, sigma: 0, games: 0 });
  });

  it('ignores a baseline built from no games', () => {
    const empty: PositionBaseline = { mean: 99, sigma: 99, sample: 0 };
    expect(project([10, 20], empty).mean).toBe(15);
  });
});

describe('buildBaselines()', () => {
  it('averages a position over every player in the window', () => {
    const b = buildBaselines(rows({
      a: { position: 'QB', points: [10, 20] },
      c: { position: 'QB', points: [12, 18] },
    }), HALF_PPR);

    expect(b.get('QB')?.mean).toBeCloseTo(15, 5);
    expect(b.get('QB')?.sample).toBe(4);
  });

  // WHY: without this the baseline is dragged down by everyone who saw a single
  //      snap, and a thin-sample starter would shrink toward a practice squad.
  it('excludes players with a single game from the baseline', () => {
    const b = buildBaselines(rows({
      starter: { position: 'RB', points: [20, 20, 20] },
      cameo:   { position: 'RB', points: [0] },
    }), HALF_PPR);

    expect(b.get('RB')?.mean).toBe(20);
    expect(b.get('RB')?.sample).toBe(3);
  });

  // WHY: the baseline is blended with player scores, so it has to be on the same
  //      scale — league rules, not nflverse's stored column.
  it('scores the baseline under the league rules', () => {
    const withCatches = [{
      playerId: 'wr', position: 'WR', fantasyPoints: 10, receptions: 8,
    }, {
      playerId: 'wr', position: 'WR', fantasyPoints: 10, receptions: 8,
    }];
    expect(buildBaselines(withCatches, { rec: 0.5 }).get('WR')?.mean).toBe(14);
    expect(buildBaselines(withCatches, { rec: 1 }).get('WR')?.mean).toBe(18);
  });

  it('skips rows with no position', () => {
    const b = buildBaselines(
      [{ playerId: 'x', position: null, fantasyPoints: 10, receptions: 0 }],
      HALF_PPR,
    );
    expect(b.size).toBe(0);
  });

  it('returns nothing for a position with no qualifying players', () => {
    const b = buildBaselines(rows({ k: { position: 'K', points: [5] } }), HALF_PPR);
    expect(b.get('K')).toBeUndefined();
  });
});
