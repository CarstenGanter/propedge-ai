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

export type SlipVerdict = "positive" | "marginal" | "negative";

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
  /** Model's estimate that every leg hits. */
  modelPAll: number;
  /** Geometric mean of the leg probabilities — comparable to breakEvenPerLeg. */
  modelPerLeg: number | null;
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
  opts?: { pIsCalibrated?: boolean },
): SlipEconomics {
  const legs = legProbabilities.length;
  const clamped = legProbabilities.map((p) => Math.max(0, Math.min(1, p)));
  const modelPAll = clamped.reduce((a, b) => a * b, 1);
  const be = breakEvenPerLeg(multiplier, legs);
  const valid = Number.isFinite(multiplier) && multiplier > 0 && legs > 0;
  const ev = valid ? multiplier * modelPAll - 1 : -1;
  const modelPerLeg = legs > 0 ? Math.pow(modelPAll, 1 / legs) : null;
  return {
    legs,
    multiplier,
    breakEvenPerLeg: be,
    modelPAll,
    modelPerLeg,
    ev,
    verdict: ev > MARGINAL_EV_BAND ? "positive" : ev < -MARGINAL_EV_BAND ? "negative" : "marginal",
    cushion: modelPerLeg != null && be != null ? modelPerLeg - be : null,
    pIsCalibrated: opts?.pIsCalibrated ?? false,
    overconfident:
      !(opts?.pIsCalibrated ?? false) && modelPerLeg != null && modelPerLeg > PLAUSIBLE_PER_LEG_CEILING,
  };
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
