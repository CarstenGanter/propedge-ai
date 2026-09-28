/**
 * When a pending pick is worth trying to settle (pure, tested).
 *
 * Settlement reads free ESPN box scores and refuses any game ESPN has not
 * marked completed, so trying too early is harmless — it just wastes a request.
 * These rules keep the scheduler from asking about games that cannot be final.
 */

/** An NFL game takes about three hours; allow a margin for overtime and delays. */
export const SETTLE_AFTER_HOURS = 3.5;

/** Don't re-ask ESPN about unfinished games more often than this. */
export const SETTLE_RETRY_MINUTES = 30;

export function dueForSettlement(
  gameStartISO: string | null,
  slateDate: string,
  today: string,
  now: Date,
): boolean {
  if (gameStartISO) {
    const start = Date.parse(gameStartISO);
    if (Number.isFinite(start)) return now.getTime() - start >= SETTLE_AFTER_HOURS * 3_600_000;
  }
  // No kickoff recorded: wait until the slate is over.
  return slateDate < today;
}

export function settleRetryDue(lastRunISO: string | null | undefined, now: Date): boolean {
  if (!lastRunISO) return true;
  const last = Date.parse(lastRunISO);
  return !Number.isFinite(last) || now.getTime() - last >= SETTLE_RETRY_MINUTES * 60_000;
}

/**
 * After this many days a pick ESPN still can't grade will not grade itself —
 * usually a name or date mismatch — so it is left for the Results page rather
 * than retried every half hour forever.
 */
export const SETTLE_GIVE_UP_DAYS = 3;

export function staleForAutoSettle(slateDate: string, today: string): boolean {
  const a = Date.parse(`${slateDate}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return (b - a) / 86_400_000 > SETTLE_GIVE_UP_DAYS;
}
