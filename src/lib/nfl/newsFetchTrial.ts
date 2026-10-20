/**
 * The news-fetch trial's rules (pure, tested). Approved 2026-10-20: one week,
 * at most 30 credits. After a running back is ruled Out — Friday's final
 * injury report or Sunday-style game-day inactives — buy that game's rushing
 * markets twice, ~10 and ~40 minutes after the change was first seen, so each
 * venue's reaction is bracketed.
 */

export const NEWS_TRIAL = {
  budgetCredits: 30,
  /** After Monday night's game; nothing is queued or fetched after this. */
  endsAt: new Date("2026-10-27T12:00:00Z"),
  positions: ["RB"],
  propTypes: ["Rushing Yards", "Rush Attempts", "Rush+Rec Yards"],
  delaysMinutes: [10, 40],
  /** One credit per market per game; reserved per fetch whether or not every market is offered. */
  creditsPerFetch: 3,
  /** Inactives are announced ~90 minutes before kickoff; a change this close counts as game day. */
  inactivesWindowMinutes: 120,
} as const;

export type NewsWindow = "friday" | "inactives";

/**
 * Which approved window a status change falls in, or null for none. Friday is
 * judged in US Eastern time, the league's clock for the final injury report.
 */
export function classifyWindow(detectedAt: Date, kickoff: Date): NewsWindow | null {
  const minutesToKick = (kickoff.getTime() - detectedAt.getTime()) / 60_000;
  if (minutesToKick < 0) return null;
  if (minutesToKick <= NEWS_TRIAL.inactivesWindowMinutes) return "inactives";
  const weekday = detectedAt.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  return weekday === "Fri" ? "friday" : null;
}

/**
 * Whether an event's fetches can be reserved: both together, so a second fetch
 * is never stranded. `committed` = credits already spent or reserved by the trial.
 */
export function canReserve(input: {
  now: Date;
  committed: number;
  creditsRemaining: number | null;
  creditFloor: number;
}): { ok: true; credits: number } | { ok: false; reason: string } {
  const credits = NEWS_TRIAL.delaysMinutes.length * NEWS_TRIAL.creditsPerFetch;
  if (input.now >= NEWS_TRIAL.endsAt) return { ok: false, reason: "the trial has ended" };
  if (input.committed + credits > NEWS_TRIAL.budgetCredits) {
    return { ok: false, reason: `would exceed the trial's ${NEWS_TRIAL.budgetCredits}-credit cap (${input.committed} committed)` };
  }
  if (input.creditsRemaining != null && input.creditsRemaining - credits < input.creditFloor) {
    return { ok: false, reason: `would leave ${input.creditsRemaining - credits} credits, below the floor of ${input.creditFloor}` };
  }
  return { ok: true, credits };
}

/** The planned fetches for one status change. */
export function planFetches(detectedAt: Date): { seq: number; dueAt: Date }[] {
  return NEWS_TRIAL.delaysMinutes.map((m, i) => ({ seq: i + 1, dueAt: new Date(detectedAt.getTime() + m * 60_000) }));
}

/** A queued fetch still worth making: due, before kickoff, inside the trial. */
export function shouldExecute(due: Date, kickoff: Date, now: Date): { go: true } | { go: false; reason: string } {
  if (now < due) return { go: false, reason: "not due" };
  if (now >= kickoff) return { go: false, reason: "kickoff passed" };
  if (now >= NEWS_TRIAL.endsAt) return { go: false, reason: "the trial has ended" };
  return { go: true };
}
