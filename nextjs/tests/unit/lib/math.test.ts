// tests/unit/lib/math.test.ts
//
// Tests for the population standard-deviation helper in src/lib/math.ts.
// No external dependencies — pure arithmetic only.

import { describe, it, expect } from '@jest/globals';
import { stdDev } from '@/lib/math';

describe('stdDev', () => {
  // WHY: An empty array has no variance. Returning 0 avoids a division-by-zero
  //      error that would produce NaN in downstream computations.
  it('returns 0 for an empty array', () => {
    expect(stdDev([])).toBe(0);
  });

  // WHY: A single value has zero spread — variance is 0 regardless of the value.
  //      The guard `values.length < 2` handles both 0 and 1 element cases.
  it('returns 0 for a single-element array', () => {
    expect(stdDev([42])).toBe(0);
  });

  // WHY: Classic textbook example with a known answer (population stddev = 2).
  //      Verifies the formula is population stddev (divides by N, not N-1).
  it('returns ~2 for the textbook [2,4,4,4,5,5,7,9] dataset', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
  });

  // WHY: All identical values → variance is 0 → stddev is exactly 0.
  //      Would catch a bug where the implementation returns a tiny floating-point
  //      rounding artifact instead of exact 0.
  it('returns 0 when all values are identical', () => {
    expect(stdDev([10, 10, 10])).toBe(0);
  });

  // WHY: Negative numbers must not confuse the mean or variance calculation.
  //      [-1, 1] has mean = 0, variance = 1, stddev = 1.
  it('handles an array with negative numbers', () => {
    expect(stdDev([-1, 1])).toBeCloseTo(1, 5);
  });

  // WHY: Two identical values is the minimal multi-element case — covers the
  //      branch where length >= 2 but variance is still 0.
  it('returns 0 for two identical values', () => {
    expect(stdDev([7, 7])).toBe(0);
  });

  // WHY: Larger spread ensures the variance accumulator and sqrt call are exercised
  //      beyond simple zero-variance paths.
  it('computes correctly for a two-element spread', () => {
    // mean = 0, variance = ((−5)^2 + 5^2) / 2 = 25, stddev = 5
    expect(stdDev([-5, 5])).toBeCloseTo(5, 5);
  });
});
