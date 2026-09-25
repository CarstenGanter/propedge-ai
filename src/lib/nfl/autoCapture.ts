/**
 * When the automatic closing-line capture should fire (pure, tested).
 *
 * Closing-line value compares the market when a pick was made against the
 * market just before kickoff. Capturing it depended on someone clicking a button
 * at the right moment, and in three weeks it never happened once. A scheduled
 * job now runs every 15 minutes on game days and uses these rules to decide
 * whether there is anything worth spending credits on.
 *
 * The window is 20-60 minutes before kickoff: close enough that the number is
 * genuinely the close, far enough out that a 15-minute cadence always lands one
 * run inside it (a 40-minute window cannot fall between two runs).
 */

export interface CaptureWindow {
  fromMinutes: number;
  toMinutes: number;
}

export const CAPTURE_WINDOW: CaptureWindow = { fromMinutes: 20, toMinutes: 60 };

/** Minutes from `now` until kickoff; negative once the game has started. */
export function minutesUntil(kickoffISO: string, now: Date): number | null {
  const t = Date.parse(kickoffISO);
  if (!Number.isFinite(t)) return null;
  return (t - now.getTime()) / 60_000;
}

/** Is this kickoff inside the capture window right now? */
export function inCaptureWindow(kickoffISO: string, now: Date, window: CaptureWindow = CAPTURE_WINDOW): boolean {
  const m = minutesUntil(kickoffISO, now);
  return m != null && m >= window.fromMinutes && m <= window.toMinutes;
}

/**
 * The decision the job makes each run, cheapest check first so that the vast
 * majority of runs — every quarter hour of every game day — cost nothing at all:
 *   1. no uncaptured picks on the slate → stop (no network)
 *   2. no kickoff inside the window     → stop (only a free, cached schedule read)
 *   3. otherwise capture those games, once.
 */
export type CaptureDecision =
  | { action: "skip"; reason: string }
  | { action: "capture"; kickoffs: string[] };

export function decideCapture(
  uncapturedPicks: number,
  kickoffs: string[],
  now: Date,
  window: CaptureWindow = CAPTURE_WINDOW,
): CaptureDecision {
  if (uncapturedPicks === 0) return { action: "skip", reason: "no uncaptured picks on this slate" };
  if (kickoffs.length === 0) return { action: "skip", reason: "no games on this slate" };
  const due = kickoffs.filter((k) => inCaptureWindow(k, now, window));
  if (due.length === 0) {
    const upcoming = kickoffs
      .map((k) => minutesUntil(k, now))
      .filter((m): m is number => m != null && m > window.toMinutes);
    const next = upcoming.length ? Math.min(...upcoming) : null;
    return {
      action: "skip",
      reason:
        next == null
          ? "every game has started or is inside 20 minutes"
          : `next kickoff in ${Math.round(next)} min — capture opens at ${window.toMinutes}`,
    };
  }
  return { action: "capture", kickoffs: due };
}
