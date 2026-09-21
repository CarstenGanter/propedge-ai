/**
 * Pick'em slip economics (pure, tested).
 *
 * Fixed-multiplier pick'em pays `multiplier × stake` when every leg hits and
 * nothing otherwise, so the arithmetic is short and exact:
 *
 *   break-even per leg = multiplier^(-1/legs)
 *   EV per unit staked = multiplier × P(all legs hit) − 1
 *
 * The break-even figure depends only on the multiplier, so it is exact and
 * worth trusting. The expected value additionally depends on the per-leg
 * probability, which today comes from a confidence score that is not a
 * calibrated probability — so EV is directional guidance for choosing between
 * slips, not a promised return. `pIsCalibrated` carries that caveat in the type
 * rather than leaving it to a comment.
 */

import { bivariateNormalCdf, normalQuantile } from "./distributions";

export type SlipVerdict = "positive" | "marginal" | "negative";

/** A known dependency between two legs, by index, as a latent correlation. */
export interface CorrelatedPair {
  i: number;
  j: number;
  rho: number;
}

/**
 * P(every leg hits), accounting for known dependencies between legs.
 *
 * Fixed-multiplier pick'em pays only when all legs hit, so the payoff depends
 * solely on this number — losing one leg and losing four pay the same nothing.
 * That makes positive correlation strictly good here: it raises P(all) while the
 * multiplier, priced as though the legs were independent, stays put. This is the
 * opposite of the intuition carried over from true-odds parlays, where a book
 * reprices correlated legs and the advantage disappears.
 *
 * Each leg is modelled as a latent normal crossing a threshold, so a pair with
 * correlation rho contributes Phi2(z_i, z_j, rho) instead of p_i * p_j. Pairs
 * are applied as independent multiplicative corrections to the product, which is
 * exact for a single pair and a first-order approximation beyond that — good
 * enough for the two- and three-leg slips this is used on, and deliberately
 * conservative since the rho values fed in are rounded down from measurement.
 */
export function jointHitProbability(probs: number[], pairs: CorrelatedPair[] = []): number {
  const p = probs.map((x) => Math.max(1e-9, Math.min(1 - 1e-9, x)));
  const independent = p.reduce((a, b) => a * b, 1);
  let adjusted = independent;
  for (const { i, j, rho } of pairs) {
    if (i === j || !p[i] || !p[j] || !Number.isFinite(rho) || rho === 0) continue;
    const joint = bivariateNormalCdf(normalQuantile(p[i]), normalQuantile(p[j]), rho);
    adjusted *= joint / (p[i] * p[j]);
  }
  return Math.max(0, Math.min(1, adjusted));
}

/** EV inside ±this band is too close to call given an uncalibrated probability. */
export const MARGINAL_EV_BAND = 0.02;

/**
 * Sportsbooks price player props efficiently, so a genuine per-leg edge much
 * beyond this is far more likely to be model overconfidence than a real edge.
 * Above it we mark the numbers as inflated rather than presenting a return the
 * model cannot actually support.
 */
export const PLAUSIBLE_PER_LEG_CEILING = 0.62;

export interface SlipEconomics {
  legs: number;
  multiplier: number;
  /** Hit rate each leg needs, just to break even. Exact. */
  breakEvenPerLeg: number | null;
  /** Model's estimate that every leg hits, including any known correlation. */
  modelPAll: number;
  /**
   * The per-leg rate an independent slip would need to reach `modelPAll`.
   * Directly comparable to `breakEvenPerLeg`; on a correlated slip it sits above
   * the average leg, which is exactly the benefit correlation buys.
   */
  modelPerLeg: number | null;
  /** Geometric mean of the raw leg probabilities, before any correlation uplift. */
  rawPerLeg: number | null;
  /** How much correlation raised P(all) over the independent product (0 when none). */
  correlationUplift: number;
  /** Expected profit per unit staked. */
  ev: number;
  verdict: SlipVerdict;
  /** How far the model's average leg sits above the break-even bar. */
  cushion: number | null;
  pIsCalibrated: boolean;
  /** The per-leg estimate exceeds what prop markets plausibly allow. */
  overconfident: boolean;
}

/** Hit rate each leg must clear for an n-leg slip at this multiplier to break even. */
export function breakEvenPerLeg(multiplier: number, legs: number): number | null {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || legs < 1) return null;
  return Math.pow(1 / multiplier, 1 / legs);
}

export function slipEconomics(
  multiplier: number,
  legProbabilities: number[],
  opts?: { pIsCalibrated?: boolean; correlatedPairs?: CorrelatedPair[] },
): SlipEconomics {
  const legs = legProbabilities.length;
  const clamped = legProbabilities.map((p) => Math.max(0, Math.min(1, p)));
  const pairs = opts?.correlatedPairs ?? [];
  const independentPAll = clamped.reduce((a, b) => a * b, 1);
  const modelPAll = pairs.length > 0 ? jointHitProbability(clamped, pairs) : independentPAll;
  const be = breakEvenPerLeg(multiplier, legs);
  const valid = Number.isFinite(multiplier) && multiplier > 0 && legs > 0;
  const ev = valid ? multiplier * modelPAll - 1 : -1;
  const modelPerLeg = legs > 0 ? Math.pow(modelPAll, 1 / legs) : null;
  const rawPerLeg = legs > 0 ? Math.pow(independentPAll, 1 / legs) : null;
  return {
    legs,
    multiplier,
    breakEvenPerLeg: be,
    modelPAll,
    modelPerLeg,
    rawPerLeg,
    correlationUplift: independentPAll > 0 ? modelPAll / independentPAll - 1 : 0,
    ev,
    verdict: ev > MARGINAL_EV_BAND ? "positive" : ev < -MARGINAL_EV_BAND ? "negative" : "marginal",
    cushion: modelPerLeg != null && be != null ? modelPerLeg - be : null,
    pIsCalibrated: opts?.pIsCalibrated ?? false,
    // Judged on the raw legs: correlation lifting P(all) is a real structural
    // gain, not the model claiming an implausible edge on any single prop.
    overconfident:
      !(opts?.pIsCalibrated ?? false) && rawPerLeg != null && rawPerLeg > PLAUSIBLE_PER_LEG_CEILING,
  };
}

export interface SizeEfficiency {
  size: number;
  multiplier: number;
  breakEvenPerLeg: number;
  /**
   * Another available size whose per-leg bar is strictly lower. A size with a
   * dominating alternative asks for a better hit rate just to break even, so
   * there is no per-leg rate at which it turns a profit and the other does not.
   */
  dominatedBy: number | null;
}

/**
 * Rank the available slip sizes by the hit rate each demands per leg.
 *
 * Pick'em multipliers do not rise smoothly with leg count, so the bar is not
 * monotonic and the cheapest size is not always the smallest. With the standard
 * Underdog ladder the 4-leg tier (10x, 56.2%) asks more per leg than either the
 * 3-leg (6x, 55.0%) or the 5-leg (20x, 54.9%) tier, making it the worst size on
 * the board despite sitting between two better ones. Derived from the
 * multipliers passed in, so a boosted or changed payout re-ranks the sizes
 * instead of leaving a stale rule of thumb in place.
 */
export function compareSlipSizes(multipliers: Record<number, number>): SizeEfficiency[] {
  const rows = Object.entries(multipliers)
    .map(([size, multiplier]) => ({ size: Number(size), multiplier }))
    .filter((r) => Number.isFinite(r.size) && r.size >= 2 && Number.isFinite(r.multiplier) && r.multiplier > 0)
    .map((r) => ({ ...r, breakEvenPerLeg: breakEvenPerLeg(r.multiplier, r.size)! }))
    .sort((a, b) => a.size - b.size);

  return rows.map((r) => {
    // Ties don't count as domination: an equal bar is not a reason to switch.
    const better = rows
      .filter((o) => o.size !== r.size && o.breakEvenPerLeg < r.breakEvenPerLeg - 1e-9)
      .sort((a, b) => a.breakEvenPerLeg - b.breakEvenPerLeg)[0];
    return { ...r, dominatedBy: better?.size ?? null };
  });
}

/**
 * Probability the added leg must clear for a slip to be worth extending from
 * `fromLegs` to `toLegs`. With standard payouts the fourth leg needs 60% while
 * the fifth needs only 50%, which is why slip size should be chosen from the
 * actual multipliers rather than by habit.
 */
export function marginalLegRequirement(
  fromMultiplier: number,
  toMultiplier: number,
): number | null {
  if (!Number.isFinite(fromMultiplier) || !Number.isFinite(toMultiplier)) return null;
  if (fromMultiplier <= 0 || toMultiplier <= 0) return null;
  return fromMultiplier / toMultiplier;
}
