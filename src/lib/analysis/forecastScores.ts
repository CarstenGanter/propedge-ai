/**
 * Scoring rules for probabilistic forecasts of a stat (pure, tested). Used to
 * decide, on held-out data, which distribution shape to trust.
 */

export type Cdf = (x: number) => number;

/**
 * Continuous ranked probability score: the integral of (F(x) − 1{x ≥ y})².
 * Rewards a distribution for being both centred and sharp; lower is better.
 * Computed on a grid over [lo, hi].
 */
export function crps(cdf: Cdf, y: number, lo: number, hi: number, steps = 200): number {
  const h = (hi - lo) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const x = lo + (i + 0.5) * h;
    const f = cdf(x);
    const ind = x >= y ? 1 : 0;
    sum += (f - ind) ** 2;
  }
  return sum * h;
}

/** −log P(y − half < Y ≤ y + half): fair across continuous families on whole-number stats. */
export function intervalLogScore(cdf: Cdf, y: number, half = 0.5): number {
  const p = Math.max(1e-12, cdf(y + half) - cdf(y - half));
  return -Math.log(p);
}

/** Binary log-loss of P(Y > line) against what happened. */
export function binaryLogLoss(pOver: number, wentOver: boolean): number {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, pOver));
  return -Math.log(wentOver ? p : 1 - p);
}

/** Bisection for the median of a CDF on [lo, hi]. */
export function medianOfCdf(cdf: Cdf, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (cdf(m) < 0.5) a = m;
    else b = m;
  }
  return (a + b) / 2;
}
