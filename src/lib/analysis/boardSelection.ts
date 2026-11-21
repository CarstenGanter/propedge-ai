/**
 * Choosing which props make the day's board (pure, tested).
 *
 * v2.0.0 (2026-11-20): the board is a strict +EV shortlist. Each prop is put in
 * a tier by boardTier (pickemMath.ts) — playable (an entered Underdog payout
 * the books' price beats by the margin), candidate (worth entering a payout
 * for: a line no tougher than the books' and books clearing the standard
 * break-even), or pass — and ranked by boardRank: expected value at the entered
 * payout, then the books' edge over break-even. Passes don't make the board, so
 * a slate may show only a few legs.
 *
 * It replaced a ranking by a payout curve learned from entered payouts, with a
 * per-prop-type cap, which filled ten slots whether or not any had an edge.
 */

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

/** Compare two boardRank keys: negative when `a` ranks ahead of `b`. */
export function compareRank(a: [number, number], b: [number, number]): number {
  return b[0] - a[0] || b[1] - a[1];
}
