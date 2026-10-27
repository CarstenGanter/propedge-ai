import type { Direction } from "@/types";
import { profileFor } from "./bookProfiles";
import { CONSENSUS_DF, isCountProp, medianOf, probOver, probPush, solveMean, specFor, type DistSpec } from "./propDistribution";

/**
 * The market's price for a player prop, built correctly from several books
 * (pure, tested).
 *
 * The previous version took the median of the books' lines but the plain mean
 * of their no-vig probabilities — even when the books were quoting different
 * lines. For yardage props the books disagree on the line ~85-90% of the time,
 * typically by 2-3 yards, and near the median a yard is worth 1.5-3 points of
 * probability, so that average was quietly wrong by several points. It also
 * paired Over and Under without checking they were at the same line.
 *
 * Here each book's quote is de-vigged at its OWN line, turned into the mean
 * that would produce it, and the means are combined. The consensus can then be
 * read at any line — the books' reference line, Underdog's line, PrizePicks'
 * whole-number line — consistently.
 */

export interface RawQuote {
  book: string;
  line: number;
  /** American odds, or null when the book posted only one side. */
  over: number | null;
  under: number | null;
  lastUpdate?: string;
}

export type QuoteStatus =
  | "used"
  | "dfs"
  | "one-sided"
  | "alternate"
  | "juice"
  | "line-outlier"
  | "mean-outlier"
  | "duplicate";

export interface BookQuote extends RawQuote {
  status: QuoteStatus;
  /** De-vigged P(over) at this book's line. */
  pOver: number | null;
  impliedMean: number | null;
  weight: number;
}

export interface ConsensusModel {
  propType: string;
  mean: number;
  sigma: number;
  df: number;
  /** Weighted median of the lines the used books posted — always a real line. */
  referenceLine: number;
  /** The line at which Over and Under are a coin flip under the consensus. */
  fairLine: number;
  pOverAtReference: number;
  /** Distinct pricing groups behind the consensus. */
  groups: number;
  reliable: boolean;
  /** Lowest and highest line the used books posted. Absent on older stored models. */
  minLine?: number;
  maxLine?: number;
  /**
   * How much of a line move to trust when reading the consensus off its own
   * line. Undefined: LINE_SHIFT_TRUST for the prop type (the default spread).
   * Null: trust the distribution fully.
   */
  lineShiftTrust?: number | null;
}

/**
 * σ = a + b × line, fitted to the books' alternate ladders by
 * src/jobs/research/fitConsensusSigma.ts: least squares in probability space
 * over every de-vigged rung, grid search, prices only.
 *
 *   Receiving Yards  a = 13.5, b = 0.27   132 ladders, 6,286 rungs, 13 games
 *                    (the 2026-10-18 slate, fetched 2026-10-17)
 *                    RMSE vs the ladders: CV-prior spread 9.51 pts → 3.30;
 *                    within 5 yards of the main line 3.35 → 3.04,
 *                    over 20 yards away 11.64 → 3.02.
 *
 * In production since 2026-10-20: passes on prices; the outcome gate is
 * underpowered (log-loss +0.0002, 95% −0.0014 to +0.0020, n = 361 held-out
 * venue lines). Re-run research:sigma-validate as off-line props accumulate
 * and revert if that interval ends up clearly above zero. A fitted prop type
 * reads the distribution undamped (no LINE_SHIFT_TRUST). Others keep the CV
 * prior × the line.
 */
export const FITTED_SPREAD_PARAMS: Record<string, { a: number; b: number }> = {
  "Receiving Yards": { a: 13.5, b: 0.27 },
};

/**
 * How wide the consensus distribution is, and how much of a line move to
 * believe — what reading the books at another line depends on. Without one,
 * buildConsensus uses the production spread: FITTED_SPREAD_PARAMS where fitted,
 * the CV prior × the line with LINE_SHIFT_TRUST elsewhere.
 */
export interface ConsensusSpread {
  name: string;
  sigma(propType: string, scale: number): number;
  /** Undefined: the default table. Null: no damping. */
  lineShiftTrust(propType: string): number | null | undefined;
}

/** Fewer independent pricing sources than this and the price is flagged as thin. */
export const RELIABLE_MIN_GROUPS = 3;

/**
 * A quote this much older than the freshest one in the same fetch counts half
 * toward the consensus, and is flagged stale.
 */
export const STALE_QUOTE_MS = 6 * 3_600_000;

/** A side priced beyond ~-300 is almost always an alternate or stale line. */
export const JUICE_LIMIT = 0.75;

export function americanToProb(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

/**
 * Power de-vig: find k with po^k + pu^k = 1 and return po^k. Removes the margin
 * in proportion to each side's odds, correcting the favourite-longshot bias the
 * multiplicative method leaves in (Clarke, Kovalchik & Ingram 2017). For the
 * near-even prices most main-line props carry the two agree closely.
 */
export function powerDevig(over: number, under: number): number | null {
  const k = powerDevigExponent(over, under);
  return k == null ? null : americanToProb(over) ** k;
}

/**
 * The exponent k with po^k + pu^k = 1 — the book's margin, as the power method
 * reads it. Applying a book's main-line k to its one-sided alternate prices is
 * how those are de-vigged for the σ fit.
 */
export function powerDevigExponent(over: number, under: number): number | null {
  const po = americanToProb(over);
  const pu = americanToProb(under);
  if (!(po > 0 && po < 1 && pu > 0 && pu < 1)) return null;
  const f = (k: number) => po ** k + pu ** k - 1;
  let lo = 0.2;
  let hi = 10;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function multiplicativeDevig(over: number, under: number): number {
  const po = americanToProb(over);
  const pu = americanToProb(under);
  return po / (po + pu);
}

export function devig(over: number, under: number): number {
  return powerDevig(over, under) ?? multiplicativeDevig(over, under);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function weightedMedian(pairs: { value: number; weight: number }[]): number {
  const s = [...pairs].sort((a, b) => a.value - b.value);
  const total = s.reduce((a, p) => a + p.weight, 0);
  let acc = 0;
  for (const p of s) {
    acc += p.weight;
    if (acc >= total / 2) return p.value;
  }
  return s[s.length - 1].value;
}

/**
 * One main quote per book. A book posting several lines for a player keeps the
 * one nearest a coin flip; the rest are its alternates.
 */
export function selectMainLines(quotes: RawQuote[]): BookQuote[] {
  const out: BookQuote[] = [];
  const byBook = new Map<string, RawQuote[]>();
  for (const q of quotes) (byBook.get(q.book) ?? byBook.set(q.book, []).get(q.book)!).push(q);
  for (const [book, qs] of byBook) {
    const role = profileFor(book).role;
    const scored = qs.map((q) => {
      const paired = q.over != null && q.under != null;
      const pOver = paired ? devig(q.over!, q.under!) : null;
      return { q, pOver };
    });
    const priced = scored.filter((s) => s.pOver != null);
    const main = priced.length
      ? priced.reduce((a, b) => (Math.abs(b.pOver! - 0.5) < Math.abs(a.pOver! - 0.5) ? b : a))
      : scored[0];
    for (const s of scored) {
      const status: QuoteStatus =
        role === "dfs" ? "dfs" : s !== main ? "alternate" : s.pOver == null ? "one-sided" : "used";
      out.push({ ...s.q, book, status, pOver: s.pOver, impliedMean: null, weight: 0 });
    }
  }
  return out;
}

export function buildConsensus(
  propType: string,
  raw: RawQuote[],
  opts: { spread?: ConsensusSpread } = {},
): { model: ConsensusModel | null; quotes: BookQuote[] } {
  const quotes = selectMainLines(raw);
  const live = () => quotes.filter((q) => q.status === "used");

  for (const q of live()) {
    if (americanToProb(q.over!) > JUICE_LIMIT || americanToProb(q.under!) > JUICE_LIMIT) q.status = "juice";
  }
  if (live().length === 0) return { model: null, quotes };

  // A line far from the others is a misprint or a different market. Real
  // disagreement on the feed runs to ~3 yards on a 44-yard line; stored
  // passing-yards outliers sat 27-30 yards off a ~250 consensus.
  const lineMedian = median(live().map((q) => q.line));
  const lineTol = Math.max(isCountProp(propType) ? 1 : 4, 0.08 * lineMedian);
  for (const q of live()) if (Math.abs(q.line - lineMedian) > lineTol) q.status = "line-outlier";
  if (live().length === 0) return { model: null, quotes };

  // One dispersion for every book on this prop, so means are comparable.
  const scale = median(live().map((q) => q.line));
  const fitted = FITTED_SPREAD_PARAMS[propType];
  const spec = opts.spread
    ? { propType, sigma: Math.max(1e-6, opts.spread.sigma(propType, scale)), df: CONSENSUS_DF }
    : fitted
      ? { propType, sigma: Math.max(1e-6, fitted.a + fitted.b * scale), df: CONSENSUS_DF }
      : specFor(propType, scale);
  for (const q of live()) q.impliedMean = solveMean(spec, q.line, q.pOver!);

  // Same line and prices within a group: one source posted twice.
  const seen = new Map<string, BookQuote>();
  for (const q of live()) {
    const g = profileFor(q.book).group;
    const prev = seen.get(g);
    if (prev && prev.line === q.line && Math.abs(prev.over! - q.over!) <= 5 && Math.abs(prev.under! - q.under!) <= 5) {
      q.status = "duplicate";
    } else if (!prev) seen.set(g, q);
  }

  // Split each group's weight across its members, halve stale quotes.
  const groupSize = new Map<string, number>();
  for (const q of live()) {
    const g = profileFor(q.book).group;
    groupSize.set(g, (groupSize.get(g) ?? 0) + 1);
  }
  const freshest = Math.max(...live().map((q) => (q.lastUpdate ? Date.parse(q.lastUpdate) : 0)));
  for (const q of live()) {
    const p = profileFor(q.book);
    const stale = q.lastUpdate && freshest - Date.parse(q.lastUpdate) > STALE_QUOTE_MS;
    q.weight = (p.weight / (groupSize.get(p.group) ?? 1)) * (stale ? 0.5 : 1);
  }

  // With enough books, drop a mean far from the rest.
  if (live().length >= 4) {
    const center = weightedMedian(live().map((q) => ({ value: q.impliedMean!, weight: q.weight })));
    const mad = median(live().map((q) => Math.abs(q.impliedMean! - center)));
    const tol = 2.5 * Math.max(1.4826 * mad, 0.15 * spec.sigma);
    for (const q of live()) if (Math.abs(q.impliedMean! - center) > tol) q.status = "mean-outlier";
  }

  const used = live();
  if (used.length === 0) return { model: null, quotes };
  const totalW = used.reduce((a, q) => a + q.weight, 0);
  const mean = totalW > 0
    ? used.reduce((a, q) => a + q.weight * q.impliedMean!, 0) / totalW
    : used.reduce((a, q) => a + q.impliedMean!, 0) / used.length;
  const referenceLine = weightedMedian(used.map((q) => ({ value: q.line, weight: q.weight || 1 })));
  const groups = new Set(used.map((q) => profileFor(q.book).group)).size;
  return {
    model: {
      propType,
      mean,
      sigma: spec.sigma,
      df: spec.df,
      referenceLine,
      fairLine: medianOf(spec, mean),
      pOverAtReference: probOver(spec, mean, referenceLine),
      groups,
      reliable: groups >= RELIABLE_MIN_GROUPS,
      minLine: Math.min(...used.map((q) => q.line)),
      maxLine: Math.max(...used.map((q) => q.line)),
      ...(opts.spread
        ? { lineShiftTrust: opts.spread.lineShiftTrust(propType) }
        : fitted
          ? { lineShiftTrust: null }
          : {}),
    },
    quotes,
  };
}

/**
 * How far beyond the lines the books actually posted a venue line may sit and
 * still be read off the consensus. One point keeps the 1-yard soft Underdog
 * lines, the range LINE_SHIFT_TRUST was measured on. Past it the number is the
 * fitted curve's extrapolation, not a price: on 2026-10-15 Underdog's
 * alternate Under 14.5 on Tory Horton (books 2.5-6.5) read 85% — the 0.7
 * trust's ceiling (0.5 + 0.7 x 0.5), the same for any player — and showed
 * green at 1.30x.
 */
export const QUOTED_RANGE_TOLERANCE = 1;

/** Whether the books' consensus prices `line`, or only extrapolates to it. */
export function pricedAt(m: ConsensusModel, line: number): boolean {
  const lo = m.minLine ?? m.referenceLine;
  const hi = m.maxLine ?? m.referenceLine;
  return line >= lo - QUOTED_RANGE_TOLERANCE - 1e-9 && line <= hi + QUOTED_RANGE_TOLERANCE + 1e-9;
}

function specOf(m: ConsensusModel): DistSpec {
  return { propType: m.propType, sigma: m.sigma, df: m.df };
}

/**
 * How much of the model's per-yard probability change to trust when reading
 * the consensus at a line other than the books' own (pure).
 *
 * Measured on nflverse weekly data 2022-25 (each game predicted from the
 * previous six): moving a yardage line one yard lower raised the Over's actual
 * hit rate by less than the model claimed — receiving 8-14 yds 2.1 pts vs 3.0,
 * rushing 8-14 2.7 vs 3.4, 14-20 1.9 vs 2.4, 20-30 1.2 vs 1.9. About 0.7 of
 * the modelled gain is real on the low lines where soft Underdog lines show
 * up. On 2026-10-04 every green pick was a 1-yard soft line on a line under
 * 16 yards, and the overstated gain is what pushed them past the margin.
 * Applied to all yardage: where the model was already accurate (higher lines)
 * this under-claims slightly, which is the safe direction for an edge.
 */
// Applies to prop types without a ladder-fitted spread (FITTED_SPREAD_PARAMS);
// receiving yards' entry is kept for the CV-prior comparison spread only.
export const LINE_SHIFT_TRUST: Record<string, number> = {
  "Receiving Yards": 0.7,
  "Rushing Yards": 0.7,
  "Rush+Rec Yards": 0.7,
};

/** The consensus P(outcome > line), at any line. */
export function consensusProbOver(m: ConsensusModel, line: number): number {
  const spec = specOf(m);
  const raw = probOver(spec, m.mean, line);
  const trust = m.lineShiftTrust !== undefined ? m.lineShiftTrust : LINE_SHIFT_TRUST[m.propType];
  if (trust == null || line === m.referenceLine) return raw;
  const atReference = probOver(spec, m.mean, m.referenceLine);
  return atReference + trust * (raw - atReference);
}

/**
 * The consensus probability that `dir` wins at `line`. At a whole-number line
 * on a count prop a tie is refunded, so the probability is conditional on no
 * tie — the chance the pick wins given it is graded.
 */
export function consensusSideProb(m: ConsensusModel, line: number, dir: Direction): number {
  const over = consensusProbOver(m, line);
  const push = probPush(specOf(m), m.mean, line);
  const under = Math.max(0, 1 - over - push);
  const decided = over + under;
  if (decided <= 0) return 0.5;
  return (dir === "OVER" ? over : under) / decided;
}

export interface HeldOut {
  book: string;
  line: number;
  /** The held-out book's own de-vigged P(over). */
  target: number;
  predicted: number;
}

/**
 * For each book, rebuild the market without it and predict its price at its
 * own line — a leak-free test of how well a method summarises the market.
 * "legacy" is the previous method: the plain mean of the others' P(over),
 * whatever line they were at.
 */
export function leaveOneBookOut(propType: string, raw: RawQuote[], method: "legacy" | "consensus"): HeldOut[] {
  const { quotes } = buildConsensus(propType, raw);
  const targets = quotes.filter((q) => q.status === "used");
  const out: HeldOut[] = [];
  for (const t of targets) {
    const rest = raw.filter((q) => q.book !== t.book);
    let predicted: number | null = null;
    if (method === "consensus") {
      const { model } = buildConsensus(propType, rest);
      if (model) predicted = consensusProbOver(model, t.line);
    } else {
      const ps = rest
        .filter((q) => q.over != null && q.under != null && profileFor(q.book).role !== "dfs")
        .map((q) => multiplicativeDevig(q.over!, q.under!));
      if (ps.length) predicted = ps.reduce((a, b) => a + b, 0) / ps.length;
    }
    if (predicted != null) out.push({ book: t.book, line: t.line, target: t.pOver!, predicted });
  }
  return out;
}

/**
 * The side the books favour at a given line — the side worth considering on a
 * venue posting that line. Chosen at the line actually played, not the books'
 * own: on 2026-10-04 the books leaned Under at their 10.5 on George Holani's
 * receiving yards, but at Underdog's 9.5 the Over was 54.9% — a soft line the
 * board was judging from the wrong side.
 */
export function favouredSide(m: ConsensusModel, line: number): Direction {
  return consensusProbOver(m, line) >= 0.5 ? "OVER" : "UNDER";
}
