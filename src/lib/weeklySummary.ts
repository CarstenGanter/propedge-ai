import type { Interval } from "@/lib/analysis/marketSkill";

/**
 * Pure pieces of research:weekly (src/jobs/research/weekly.ts): the NFL
 * week's boundary, the σ keep/revert rule, and the credit ledger's
 * consistency check.
 */

/** One sample of the σ validation (validateConsensusSigma.ts). */
export interface SigmaSample {
  sample: "held-out" | "fit-week" | "after-fit" | "pooled";
  n: number;
  games: number;
  /** Mean log-loss, fitted − current spread; negative favours fitted. */
  diff: number | null;
  interval: Interval | null;
  eceCurrent: number | null;
  eceFitted: number | null;
  /** The pre-stated gate, on the held-out sample only. */
  gate: "PASS" | "FAIL" | null;
}

/**
 * The fitted σ was adopted on prices with an underpowered outcome gate. The
 * revert rule (decided 2026-10-20) reads one sample only: the original
 * held-out weeks pooled with every week after the fit week — never the fit
 * week, whose prices the fit used. Revert only if that pooled log-loss
 * interval sits clearly above zero (its 95% lower bound above zero): fitted σ
 * reading outcomes worse than the current spread. The separate samples are
 * shown for information and trigger nothing.
 */
export function sigmaVerdict(samples: SigmaSample[]): { verdict: "keep" | "REVERT"; reason: string } {
  const pooled = samples.find((s) => s.sample === "pooled");
  if (!pooled?.interval) return { verdict: "keep", reason: "no pooled interval yet" };
  const iv = `[${pooled.interval.lo.toFixed(4)}, ${pooled.interval.hi.toFixed(4)}]`;
  if (pooled.interval.lo > 0) return { verdict: "REVERT", reason: `pooled log-loss interval ${iv} sits above zero: fitted σ reads outcomes worse` };
  return { verdict: "keep", reason: `pooled log-loss interval ${iv} is not above zero` };
}

const ET = "America/New_York";
const etDate = new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" });
const etWeekday = new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short" });
const etOffset = new Intl.DateTimeFormat("en-US", { timeZone: ET, timeZoneName: "shortOffset" });
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Midnight US Eastern at the start of a "YYYY-MM-DD" date, as an instant. */
export function easternMidnight(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const off = etOffset.formatToParts(noon).find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const hours = Number(off.replace("GMT", "") || 0);
  return new Date(Date.UTC(y, m - 1, d, -hours));
}

/**
 * The start of the current NFL week: the latest Wednesday 00:00 Eastern at or
 * before `now`. Wednesday has no games, so a run late Monday night or on
 * Tuesday still covers Thursday through Monday.
 */
export function nflWeekStart(now: Date): Date {
  const back = (DAYS.indexOf(etWeekday.format(now)) - 3 + 7) % 7;
  const [y, m, d] = etDate.format(now).split("-").map(Number);
  const wed = new Date(Date.UTC(y, m - 1, d - back, 12));
  return easternMidnight(wed.toISOString().slice(0, 10));
}

export interface LedgerRow {
  at: Date;
  credits: number;
  remaining: number | null;
}

/**
 * Credits the balance trail cannot account for: between two consecutive
 * logged calls, the balance should drop by exactly the later call's cost.
 * Anything more was spent by a request that never reached the ledger (another
 * use of the key, or the dashboard). Overlapping requests can arrive out of
 * order, raising the balance by at most the two calls' costs; their
 * differences cancel in the sum. A larger rise is the monthly reset, which
 * starts a new trail.
 */
export function unaccountedCredits(rows: LedgerRow[]): number {
  const trail = rows.filter((r) => r.remaining != null).sort((a, b) => a.at.getTime() - b.at.getTime());
  let gap = 0;
  for (let i = 1; i < trail.length; i++) {
    const prev = trail[i - 1];
    const cur = trail[i];
    if (cur.remaining! > prev.remaining! + prev.credits + cur.credits) continue; // reset
    gap += prev.remaining! - cur.remaining! - cur.credits;
  }
  return gap;
}

/** "+0.42 pts [−1.10, +1.95]" with a marker when the interval excludes zero. */
export function fmtInterval(x: number, iv: Interval | null, digits: number, unit = ""): string {
  const s = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
  const flag = iv && (iv.lo > 0 || iv.hi < 0) ? "  ◀ excludes zero" : "";
  return `${s(x)}${unit}${iv ? ` [${s(iv.lo)}, ${s(iv.hi)}]` : ""}${flag}`;
}
