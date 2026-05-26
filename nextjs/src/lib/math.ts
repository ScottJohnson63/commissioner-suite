// src/lib/math.ts — Small statistical helpers.

/** Population standard deviation of an array of numbers. Returns 0 for < 2 values. */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean     = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
