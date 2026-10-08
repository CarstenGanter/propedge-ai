import { STANDARD_PICK_PAYOUT } from "./pickemMath";

/**
 * Choosing which props make the day's board under the probability model (pure,
 * tested).
 *
 * The board used to keep picks the model rated 55%+. Once the model stopped
 * double-counting context (v1.5.0) and began agreeing with the books, that
 * floor quietly shut out every yardage prop — books set yardage lines at the
 * median, so both sides sit near 50% — and kept only the lopsided receptions
 * and TD sides that clear 55%. On 2026-09-28 the board was 10 of 10 low-line
 * receptions/TD favourites, all priced by Underdog at 1.52-1.62x and all red.
 *
 * Those favourites are also Underdog's most expensive picks. From the payouts
 * entered so far, the value it leaves you (books' probability x payout) falls
 * as the pick gets likelier: ~0.935 at 50%, ~0.896 at 65%. So the board now
 * ranks by that expected value, learned from your own entries, and caps how
 * many picks of one type it will take so yardage is represented.
 *
 * Nothing here claims an edge: every predicted value is below 1. The board is a
 * shortlist of the cheapest props to check on Underdog; entering the line and
 * payout is what can turn one green.
 */

export interface PricePoint {
  /** Books' no-vig probability of the side, 0..1. */
  books: number;
  /** What Underdog paid for that side. */
  payout: number;
}

export interface PricingFit {
  intercept: number;
  slope: number;
  /** Points behind the fit (0 for the built-in prior). */
  n: number;
  source: "learned" | "prior";
}

/**
 * Fitted on 2026-09-28 from 21 entered payouts (books 50.5-65.5%, lines
 * matching the books): value = 1.067 - 0.264 x books, residual sd 0.026.
 */
export const PRIOR_PRICING: PricingFit = { intercept: 1.067, slope: -0.264, n: 0, source: "prior" };

/** Below this many points the prior is used instead of a noisy fit. */
export const MIN_POINTS_TO_LEARN = 10;

/**
 * Least-squares line of value (books x payout) on books probability, from
 * entered payouts. Points outside the range Underdog actually prices, or with
 * nonsense inputs, are ignored.
 */
export function fitUnderdogPricing(points: PricePoint[]): PricingFit {
  const pts = points.filter(
    (p) => Number.isFinite(p.books) && Number.isFinite(p.payout) && p.books >= 0.45 && p.books <= 0.8 && p.payout > 1,
  );
  if (pts.length < MIN_POINTS_TO_LEARN) return PRIOR_PRICING;
  const xs = pts.map((p) => p.books);
  const ys = pts.map((p) => p.books * p.payout);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx < 1e-9) return PRIOR_PRICING; // every point at one probability: no slope to learn
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  return { intercept: my - slope * mx, slope, n: pts.length, source: "learned" };
}

/** Expected books x payout for a side the books put at `books`, under this fit. */
export function expectedValueAtUnderdog(books: number, fit: PricingFit = PRIOR_PRICING): number {
  return fit.intercept + fit.slope * books;
}

/** Most picks of one prop type a board of `size` will take. */
export function perTypeCap(size: number): number {
  return Math.max(2, Math.ceil(size / 3));
}

/**
 * Take items in the given order until `size` are chosen, skipping any whose
 * type has already reached `cap`. If the caps leave the board short, the
 * remainder is filled in order — a board with fewer types should still fill.
 */
export function selectWithTypeCap<T>(ordered: T[], typeOf: (t: T) => string, size: number, cap = perTypeCap(size)): T[] {
  const chosen: T[] = [];
  const counts = new Map<string, number>();
  const skipped: T[] = [];
  for (const item of ordered) {
    if (chosen.length >= size) break;
    const k = typeOf(item);
    const c = counts.get(k) ?? 0;
    if (c >= cap) {
      skipped.push(item);
      continue;
    }
    counts.set(k, c + 1);
    chosen.push(item);
  }
  for (const item of skipped) {
    if (chosen.length >= size) break;
    chosen.push(item);
  }
  return chosen;
}

/**
 * A prop's value for ranking the board: books' probability x what Underdog
 * pays for it.
 *
 * When Underdog's line is known, the payout is the one entered, else standard:
 * the feed only carries Underdog's base market, whose picks pay the standard
 * multiplier, so a line seen there is one Underdog is pricing as a coin flip.
 * That is exactly a soft line when the books disagree — on 2026-10-04 George
 * Holani's Higher 9.5 receiving yards was 54.9% by the books at a standard
 * 1.87x (1.027), yet the pricing curve, which assumes a 55% pick is a
 * discounted favourite, ranked it off the board.
 *
 * With no Underdog line yet, the curve learned from entered payouts predicts
 * the price. A thin market (fewer than three independent books) is capped at
 * break-even: the app never calls an edge on one.
 */
export function boardValue(c: {
  marketProb: number | null;
  underdogLine: number | null;
  underdogPayout: number | null;
  reliable: boolean;
  predicted: (books: number) => number;
}): number {
  const p = c.marketProb ?? 0.5;
  const v = c.underdogLine != null ? p * (c.underdogPayout ?? STANDARD_PICK_PAYOUT) : c.predicted(p);
  return c.reliable ? v : Math.min(v, 1);
}

/**
 * Keep each player's best prop only (items must already be in rank order).
 * The board is a shortlist to check on Underdog; one player's correlated
 * props crowding it — Emanuel Wilson held 3 of 10 slots on 2026-10-04 — leave
 * fewer independent chances, and a slip can't use two of them anyway.
 */
export function onePerPlayer<T>(ordered: T[], playerOf: (t: T) => string): T[] {
  const seen = new Set<string>();
  return ordered.filter((t) => {
    const k = playerOf(t).trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
