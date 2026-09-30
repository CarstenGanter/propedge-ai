import { negBinomialCdf } from "./distributions";
import { COUNT_PROPS, cvPrior, solveProjectionForMarket, tailProbability } from "./probabilityModel";

/**
 * One distribution interface shared by the market consensus and the model
 * (pure, tested), so the books' implied mean and the model's tail are read off
 * the same shape. Changing the shape later — e.g. a right-skewed family for
 * yardage — then happens here, in one place.
 *
 * With no player sample to lean on, dispersion comes from the measured
 * per-prop coefficient of variation times a scale (the prop's line).
 */

/** Fat enough to be robust, thin enough to act almost normal. */
export const CONSENSUS_DF = 30;

export interface DistSpec {
  propType: string;
  sigma: number;
  df: number;
}

export function isCountProp(propType: string): boolean {
  return COUNT_PROPS.has(propType);
}

export function specFor(propType: string, scale: number): DistSpec {
  return { propType, sigma: Math.max(1e-6, cvPrior(propType) * Math.max(scale, 1)), df: CONSENSUS_DF };
}

/** P(outcome > line). For a whole-number line on a count prop, that excludes the tie. */
export function probOver(spec: DistSpec, mean: number, line: number): number {
  return tailProbability(line, mean, spec.sigma, spec.propType, spec.df);
}

/**
 * P(outcome lands exactly on the line). Zero except for a whole-number line on
 * a count prop — PrizePicks posts receptions at 2 and 3, and a tie is refunded.
 */
export function probPush(spec: DistSpec, mean: number, line: number): number {
  if (!isCountProp(spec.propType) || !Number.isInteger(line) || line < 0) return 0;
  const variance = Math.max(spec.sigma * spec.sigma, mean);
  const atOrBelow = negBinomialCdf(line, mean, variance);
  const below = line === 0 ? 0 : negBinomialCdf(line - 1, mean, variance);
  return Math.max(0, atOrBelow - below);
}

/** The mean that reproduces `pOver` at `line` under this spec. */
export function solveMean(spec: DistSpec, line: number, pOver: number): number {
  return solveProjectionForMarket(line, pOver, spec.sigma, spec.propType, spec.df);
}

/** The line at which Over and Under would be a coin flip — the fair line. */
export function medianOf(spec: DistSpec, mean: number): number {
  let lo = 0;
  let hi = Math.max(mean * 3, mean + 10 * spec.sigma, 10);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (probOver(spec, mean, mid) > 0.5) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
