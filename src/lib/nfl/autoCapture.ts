/**
 * When the automatic closing-line capture should fire, and for which games
 * (pure, tested).
 *
 * Closing-line value compares the market when a pick was made against the
 * market just before kickoff. A scheduled job runs every 15 minutes on game days
 * and uses these rules to decide whether anything is worth spending credits on.
 *
 * The window is 20-60 minutes before kickoff: close enough that the number is
 * genuinely the close, far enough out that a 15-minute cadence always lands one
 * run inside it (a 40-minute window cannot fall between two runs).
 *
 * Two rules exist because their absence cost ~130 credits on 2026-09-27:
 *  - Only games that contain an uncaptured pick are due. The first version asked
 *    "is any pick on the slate uncaptured?" and "is any game about to start?"
 *    separately, so picks in the 4pm games kept paying for re-fetches of every
 *    1pm game.
 *  - Each game is attempted once. A pick whose prop the books pulled near
 *    kickoff never matches, and without this it re-bought the whole game every
 *    15 minutes until the window closed.
 */

export interface CaptureWindow {
  fromMinutes: number;
  toMinutes: number;
}

export const CAPTURE_WINDOW: CaptureWindow = { fromMinutes: 20, toMinutes: 60 };

/** A game on the slate that still has at least one pick without a closing line. */
export interface UncapturedGame {
  gameId: string;
  kickoffISO: string;
  home: string;
  away: string;
  picks: number;
}

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

export type CaptureDecision =
  | { action: "skip"; reason: string }
  | { action: "capture"; games: UncapturedGame[] };

/**
 * Which games to capture this run. Cheapest outcome first: most runs find
 * nothing due and spend nothing.
 */
export function decideCapture(
  games: UncapturedGame[],
  attempted: ReadonlySet<string>,
  now: Date,
  window: CaptureWindow = CAPTURE_WINDOW,
): CaptureDecision {
  if (games.length === 0) return { action: "skip", reason: "no uncaptured picks on this slate" };

  const inWindow = games.filter((g) => inCaptureWindow(g.kickoffISO, now, window));
  const due = inWindow.filter((g) => !attempted.has(g.gameId));
  if (due.length > 0) return { action: "capture", games: due };

  if (inWindow.length > 0) {
    return {
      action: "skip",
      reason: `${inWindow.length} game(s) in the window were already attempted — not paying twice`,
    };
  }
  const upcoming = games
    .map((g) => minutesUntil(g.kickoffISO, now))
    .filter((m): m is number => m != null && m > window.toMinutes);
  const next = upcoming.length ? Math.min(...upcoming) : null;
  return {
    action: "skip",
    reason:
      next == null
        ? "every game with uncaptured picks has started or is inside 20 minutes"
        : `next game with uncaptured picks in ${Math.round(next)} min — capture opens at ${window.toMinutes}`,
  };
}
