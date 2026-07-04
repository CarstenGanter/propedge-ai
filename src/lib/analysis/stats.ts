/** Small numeric helpers used by the scoring engine (kept pure & testable). */

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Count how many values "hit" the line for a direction.
 * OVER hits when value > line, UNDER when value < line; equal is a push.
 */
export function hitCount(
  values: number[],
  line: number,
  direction: "OVER" | "UNDER",
): { hits: number; pushes: number; total: number } {
  let hits = 0;
  let pushes = 0;
  for (const v of values) {
    if (v === line) pushes++;
    else if (direction === "OVER" ? v > line : v < line) hits++;
  }
  return { hits, pushes, total: values.length };
}

/** Smoothly map a favorability margin to a 0..100 sub-score centered on 50. */
export function marginToScore(margin: number, scale: number): number {
  if (scale <= 0) return 50;
  return clamp(50 + 50 * Math.tanh(margin / scale), 0, 100);
}
