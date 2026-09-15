import type { Direction, ResearchBundle, ScorablePropInput } from "@/types";
import { mean as avg, stdDev } from "./stats";
import { negBinomialCdf, studentTCdf } from "./distributions";

/**
 * Estimate P(stat beats the line) directly, instead of blending 0-100 "lean"
 * scores and hoping the result reads like a percentage.
 *
 * Three stages:
 *  1. a projection, shrinking the player's own average toward the number the
 *     market implies — the market is the strongest prior available, and a
 *     4-game sample is noisy;
 *  2. a dispersion estimate, shrunk toward a per-prop-type prior because a
 *     standard deviation from 4 games has ~40% relative error on its own;
 *  3. the tail probability, from a count distribution for counting props and a
 *     Student-t for yardage, which keeps early-season samples honest.
 *
 * The output is a probability, so the two sides of a prop necessarily sum to 1
 * and it can be fed to Brier/log-loss and to parlay maths without pretending.
 */

/** Counting props use a discrete distribution; everything else is continuous. */
const COUNT_PROPS = new Set([
  "Receptions",
  "Pass TDs",
  "Completions",
  "Pass Attempts",
  "Rush Attempts",
]);

/**
 * Typical coefficient of variation per prop family, used to shrink a noisy
 * sample standard deviation. Derived from the structure of the stat, not fitted
 * to results: yardage carries per-play variance that counts do not.
 */
function cvPrior(propType: string): number {
  if (COUNT_PROPS.has(propType)) return 0.45;
  if (propType === "Rush+Rec Yards") return 0.5;
  return 0.55; // receiving / rushing / passing yards
}

/**
 * Spread of a player's true per-game mean *around the market's estimate*, as a
 * fraction of the line. Small on purpose: a de-vigged consensus of several
 * books is a far better forecast than a 15-game sample, and our own line data
 * shows the pick'em site matching those books ~88% of the time. This makes the
 * market the anchor and the player's form a modest correction, rather than the
 * other way round.
 */
const TAU_FRACTION = 0.05;

/**
 * Sportsbooks price props well. Anything outside this band is far more likely
 * to be model error than a real edge, so we refuse to claim it.
 */
export const MIN_PROB = 0.33;
export const MAX_PROB = 0.7;

export interface ProbabilityEstimate {
  /** P(the pick's side wins), already clipped to a defensible band. */
  probability: number;
  projection: number;
  sigma: number;
  /** Games behind the estimate. */
  games: number;
  /** True when the market anchored the projection. */
  usedMarket: boolean;
  clipped: boolean;
  note: string;
}

export interface ProbabilityInputs {
  line: number;
  direction: Direction;
  propType: string;
  games: number[];
  /** De-vigged market probability of the OVER, at `marketLine`. */
  marketProbOver?: number | null;
  marketLine?: number | null;
  /** Bounded multiplicative adjustments to the projection, e.g. +0.04 for a soft matchup. */
  adjustments?: number[];
}

/** Total adjustment is capped so context can sharpen a projection, never invent one. */
export const MAX_TOTAL_ADJUSTMENT = 0.15;

/** P(stat > line) for a given mean and spread, in the family the prop needs. */
export function tailProbability(
  line: number,
  projection: number,
  sigma: number,
  propType: string,
  df: number,
): number {
  if (COUNT_PROPS.has(propType)) {
    const variance = Math.max(sigma * sigma, projection);
    return 1 - negBinomialCdf(Math.floor(line), projection, variance);
  }
  return 1 - studentTCdf((line - projection) / sigma, Math.max(1, df));
}

/**
 * The mean that would reproduce the market's own over-probability at the
 * market's line, under the same distribution we use for the tail. Solving it
 * this way (rather than inverting a normal) means that when the pick'em line
 * equals the book's line and nothing else fires, our probability *is* the
 * market's — and any departure is something we can point at.
 */
export function solveProjectionForMarket(
  marketLine: number,
  probOver: number,
  sigma: number,
  propType: string,
  df: number,
): number {
  let lo = 0;
  let hi = Math.max(marketLine * 3, marketLine + 10 * sigma, 10);
  // The tail is increasing in the mean, so bisection is safe.
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tailProbability(marketLine, mid, sigma, propType, df) < probOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function estimateProbability(input: ProbabilityInputs): ProbabilityEstimate | null {
  const games = input.games.filter((g) => Number.isFinite(g));
  const n = games.length;
  const line = input.line;
  if (n === 0 || !Number.isFinite(line) || line <= 0) return null;

  const sampleMean = avg(games);
  const sampleSd = n >= 2 ? stdDev(games) : 0;

  // --- dispersion: shrink the sample sd toward a structural prior ---
  const priorSd = cvPrior(input.propType) * Math.max(sampleMean, line);
  // A sd from n games has relative error ~1/sqrt(2(n-1)); weight accordingly.
  const wSd = n >= 2 ? (n - 1) / (n - 1 + 4) : 0;
  const sigma = Math.max(1e-6, Math.sqrt(wSd * sampleSd * sampleSd + (1 - wSd) * priorSd * priorSd));

  // --- projection: anchor on the market, correct with the player's own form ---
  const df = Math.max(1, n - 1);
  let projection = sampleMean;
  let usedMarket = false;
  const marketLine = input.marketLine ?? line;
  const pOver = input.marketProbOver;
  if (pOver != null && pOver > 0.01 && pOver < 0.99 && Number.isFinite(marketLine)) {
    const marketMean = solveProjectionForMarket(marketLine, pOver, sigma, input.propType, df);
    const tau = TAU_FRACTION * Math.max(line, 1);
    const k = sigma * sigma / n / (sigma * sigma / n + tau * tau); // weight on the market
    projection = k * marketMean + (1 - k) * sampleMean;
    usedMarket = true;
  }

  // --- context adjustments, bounded ---
  const rawAdj = (input.adjustments ?? []).reduce((a, b) => a + b, 0);
  const adj = Math.max(-MAX_TOTAL_ADJUSTMENT, Math.min(MAX_TOTAL_ADJUSTMENT, rawAdj));
  projection = Math.max(0, projection * (1 + adj));

  // --- tail probability, read at the line actually being played ---
  const pOverAtLine = tailProbability(line, projection, sigma, input.propType, df);
  const raw = input.direction === "OVER" ? pOverAtLine : 1 - pOverAtLine;
  const probability = Math.max(MIN_PROB, Math.min(MAX_PROB, raw));
  const clipped = Math.abs(probability - raw) > 1e-9;

  const note =
    `Projection ${projection.toFixed(1)} vs line ${line} with spread ${sigma.toFixed(1)}` +
    ` over ${n} game${n === 1 ? "" : "s"}` +
    (usedMarket ? ", anchored to the market's implied mean" : "") +
    (clipped ? ". Clipped — the raw estimate exceeded what prop markets plausibly allow" : "") +
    ".";

  return { probability, projection, sigma, games: n, usedMarket, clipped, note };
}

/** Context signals expressed as bounded nudges to the projection. */
export function adjustmentsFrom(prop: ScorablePropInput, bundle: ResearchBundle): number[] {
  const out: number[] = [];
  const m = bundle.matchup;
  if (m?.opponentDefenseRank && m.leagueSize && m.leagueSize > 1) {
    // rank 1 = toughest. Softness in -0.5..0.5, worth up to ±6%.
    const softness = (m.opponentDefenseRank - 1) / (m.leagueSize - 1) - 0.5;
    out.push(softness * 0.12);
  }
  if (m?.environmentFavor != null) {
    // environmentFavor is signed for the pick's direction; the projection is
    // direction-free, so undo that here.
    const signed = prop.direction === "OVER" ? m.environmentFavor : -m.environmentFavor;
    out.push(signed * 0.05);
  }
  const ps = bundle.playerStats;
  if (ps?.usageTrend === "up") out.push(0.04);
  if (ps?.usageTrend === "down") out.push(-0.04);
  if (ps?.snapPct != null && ps.snapPct < 0.5) out.push(-0.06);
  if (bundle.news?.teammateAbsencesBoost) out.push(0.06);
  if (bundle.historical?.weatherConcern) out.push(-0.05);
  const status = bundle.news?.playerStatus;
  if (status === "doubtful") out.push(-0.12);
  if (status === "questionable" || status === "gtd") out.push(-0.05);
  return out;
}
