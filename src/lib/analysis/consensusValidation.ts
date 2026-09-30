import type { HeldOut } from "./marketConsensus";

/**
 * Scores for leave-one-book-out predictions (pure). The target is a book's own
 * de-vigged probability, so the natural loss is the KL divergence from it — the
 * cross-entropy against a soft label, minus that label's own entropy.
 */
export interface HeldOutScore {
  n: number;
  /** Mean KL divergence, nats. Lower is better; 0 is perfect. */
  kl: number;
  /** Mean absolute error, probability points. */
  maePts: number;
}

function klTerm(p: number, q: number): number {
  const eps = 1e-9;
  const qq = Math.min(1 - eps, Math.max(eps, q));
  const t = (x: number, y: number) => (x <= 0 ? 0 : x * Math.log(x / y));
  return t(p, qq) + t(1 - p, 1 - qq);
}

export function scoreHeldOut(rows: HeldOut[]): HeldOutScore {
  if (rows.length === 0) return { n: 0, kl: Number.NaN, maePts: Number.NaN };
  const kl = rows.reduce((a, r) => a + klTerm(r.target, r.predicted), 0) / rows.length;
  const mae = rows.reduce((a, r) => a + Math.abs(r.target - r.predicted), 0) / rows.length;
  return { n: rows.length, kl, maePts: mae * 100 };
}
