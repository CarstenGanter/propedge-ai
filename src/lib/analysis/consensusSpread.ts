import { cvPrior } from "./probabilityModel";
import {
  americanToProb,
  buildConsensus,
  consensusProbOver,
  powerDevigExponent,
  type ConsensusSpread,
  type RawQuote,
} from "./marketConsensus";
import { profileFor } from "./bookProfiles";

/**
 * Fitting the consensus spread to the books' own alternate ladders (pure,
 * tested). A ladder prices the same player at many lines, so it shows directly
 * how fast the books' probability falls away from their main line — exactly
 * what the consensus has to get right to read the books at an Underdog or
 * PrizePicks line.
 */

/** Today's spread: the measured CV prior × the line, damped by LINE_SHIFT_TRUST. */
export const CURRENT_SPREAD: ConsensusSpread = {
  name: "cv-prior",
  sigma: (propType, scale) => cvPrior(propType) * Math.max(scale, 1),
  lineShiftTrust: () => undefined,
};

/** σ = a + b × line for the fitted prop types, no damping; the current spread elsewhere. */
export function affineSpread(params: Record<string, { a: number; b: number }>, name = "affine-fit"): ConsensusSpread {
  return {
    name,
    sigma: (propType, scale) => {
      const p = params[propType];
      return p ? p.a + p.b * scale : CURRENT_SPREAD.sigma(propType, scale);
    },
    // A fitted spread already reproduces prices off the main line, so no damping;
    // other prop types keep the default (undefined = the LINE_SHIFT_TRUST table).
    lineShiftTrust: (propType) => (params[propType] ? null : undefined),
  };
}

export interface Rung {
  line: number;
  /** De-vigged P(over) at `line`. */
  pOver: number;
}

export interface Ladder {
  propType: string;
  /** The books' main-line quotes for this player prop (two-sided). */
  main: RawQuote[];
  rungs: Rung[];
}

/**
 * De-vig one book's one-sided alternate Overs with the exponent of that same
 * book's two-sided main line for the player (the power method, applied with the
 * book's own margin). Books without a two-sided main quote are skipped, and so
 * are pick'em venues, which are compared against the market, never part of it.
 */
export function devigLadder(main: RawQuote[], alternates: { book: string; line: number; over: number | null }[]): Rung[] {
  const exponent = new Map<string, number>();
  for (const q of main) {
    if (q.over == null || q.under == null || profileFor(q.book).role === "dfs") continue;
    const k = powerDevigExponent(q.over, q.under);
    if (k != null && !exponent.has(q.book)) exponent.set(q.book, k);
  }
  const out: Rung[] = [];
  for (const a of alternates) {
    const k = exponent.get(a.book);
    if (k == null || a.over == null) continue;
    out.push({ line: a.line, pOver: americanToProb(a.over) ** k });
  }
  return out;
}

export interface LadderFit {
  sse: number;
  rungs: number;
  ladders: number;
}

/** Squared error between the consensus's P(over) and the ladder's, over every rung. */
export function ladderLoss(ladders: Ladder[], spread: ConsensusSpread): LadderFit {
  let sse = 0;
  let rungs = 0;
  let used = 0;
  for (const l of ladders) {
    const m = buildConsensus(l.propType, l.main, { spread }).model;
    if (!m || l.rungs.length === 0) continue;
    used++;
    for (const r of l.rungs) {
      sse += (consensusProbOver(m, r.line) - r.pOver) ** 2;
      rungs++;
    }
  }
  return { sse, rungs, ladders: used };
}

/**
 * Grid search for σ = a + b × line on one prop type, coarse then fine.
 * Squared error in probability space gives the far rungs — where de-vigging
 * a one-sided longshot price is least certain — little weight on their own.
 */
export function fitAffineSigma(
  propType: string,
  ladders: Ladder[],
  opts: { aMax?: number; bMax?: number } = {},
): { a: number; b: number } & LadderFit {
  const mine = ladders.filter((l) => l.propType === propType);
  const aMax = opts.aMax ?? 40;
  const bMax = opts.bMax ?? 1.5;
  const evalAt = (a: number, b: number) => ladderLoss(mine, affineSpread({ [propType]: { a, b } }));
  // Start from today's σ (CV prior × line), undamped.
  let best = { a: 0, b: cvPrior(propType), ...evalAt(0, cvPrior(propType)) };
  const scan = (as: number[], bs: number[]) => {
    for (const a of as)
      for (const b of bs) {
        if (a + b <= 0) continue;
        const f = evalAt(a, b);
        if (f.sse < best.sse) best = { a, b, ...f };
      }
  };
  const range = (lo: number, hi: number, step: number) => {
    const xs: number[] = [];
    for (let x = Math.max(0, lo); x <= hi + 1e-9; x += step) xs.push(Math.round(x * 1000) / 1000);
    return xs;
  };
  scan(range(0, aMax, 4), range(0, bMax, 0.1));
  scan(range(best.a - 4, best.a + 4, 0.5), range(best.b - 0.1, best.b + 0.1, 0.01));
  return best;
}

/**
 * σ = a + b × line, fitted to the books' alternate ladders by
 * src/jobs/research/fitConsensusSigma.ts: least squares in probability space
 * over every de-vigged rung, grid search, no outcomes used.
 *
 *   Receiving Yards  a = 13.5, b = 0.27   132 ladders, 6,286 rungs, 13 games
 *                    (the 2026-10-18 slate, fetched 2026-10-17)
 *                    RMSE vs the ladders: current spread 9.51 pts → 3.30;
 *                    within 5 yards of the main line 3.35 → 3.04,
 *                    over 20 yards away 11.64 → 3.02.
 *
 * Other prop types have no ladders yet and keep the current spread. Whether
 * this replaces the current spread in production is decided by its graded
 * outcomes on held-out weeks (src/jobs/research/validateConsensusSigma.ts).
 */
export const FITTED_SPREAD_PARAMS: Record<string, { a: number; b: number }> = {
  "Receiving Yards": { a: 13.5, b: 0.27 },
};
export const FITTED_SPREAD = affineSpread(FITTED_SPREAD_PARAMS, "ladder-fit-2026-10-18");
