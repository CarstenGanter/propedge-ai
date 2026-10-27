import { clusterBootstrap, OVER_CONFIRM_WEEKS, type Interval, type OverGapStatus } from "@/lib/analysis/marketSkill";
import { breakEvenPerLeg, pickBreakEven, valueVerdict } from "@/lib/analysis/pickemMath";

/**
 * Pure pieces of research:weekly (src/jobs/research/weekly.ts): the NFL
 * week's boundary, the σ keep/revert rule, the credit ledger's consistency
 * check, and the green-pick summary.
 */

/**
 * The board's green rule (UnderdogLineTable's NeedsCell): the books' P(our
 * side) times Underdog's payout — standard when none was entered — clears
 * VALUE_MARGIN, and the price is not thin (fewer than three independent books,
 * or an Underdog line beyond any line the books posted).
 */
export function isGreen(p: { books: number | null; payout: number | null; reliable: boolean | null; priced: boolean | null }): boolean {
  if (p.books == null || p.reliable === false || p.priced === false) return false;
  return valueVerdict(p.books / pickBreakEven(p.payout)) === "edge";
}

export interface GreenPick {
  cluster: string;
  hit: boolean;
  /** Books' P(our side) at pick time, as the green rule read it. */
  books: number;
  /** Entry and close at the line played, for CLV; close null when no pre-kickoff quote is stored. */
  entry: number | null;
  close: number | null;
}

export interface GreenSummary {
  n: number;
  hits: number;
  hitRate: number | null;
  meanBooks: number | null;
  clv: {
    n: number;
    /** Picks left out because no quote before kickoff is stored. */
    missing: number;
    meanPts: number | null;
    interval: Interval | null;
    beatPct: number | null;
  };
}

/** Same threshold as clvSummary: a change under 0.05 pts is no change. */
const CLV_EPS = 0.0005;

export function greenSummary(picks: GreenPick[], opts: { reps?: number; seed?: number } = {}): GreenSummary {
  const hits = picks.filter((p) => p.hit).length;
  const withClose = picks.filter((p) => p.entry != null && p.close != null).map((p) => ({ cluster: p.cluster, d: p.close! - p.entry! }));
  const mean = (xs: { d: number }[]) => (xs.length ? (xs.reduce((s, x) => s + x.d, 0) / xs.length) * 100 : null);
  return {
    n: picks.length,
    hits,
    hitRate: picks.length ? hits / picks.length : null,
    meanBooks: picks.length ? picks.reduce((s, p) => s + p.books, 0) / picks.length : null,
    clv: {
      n: withClose.length,
      missing: picks.length - withClose.length,
      meanPts: mean(withClose),
      interval: withClose.length ? clusterBootstrap(withClose, mean, opts) : null,
      beatPct: withClose.length ? (withClose.filter((x) => x.d > CLV_EPS).length / withClose.length) * 100 : null,
    },
  };
}

export interface EntryPlayed {
  /** Picks in the entry; 1 for a single. */
  legs: number;
  multiplier: number;
}

export interface BreakEvenRow {
  label: string;
  entries: number;
  medianMultiplier: number;
  /** Per-leg hit rate the median multiplier needs: multiplier^(-1/legs). */
  breakEvenPerLeg: number;
}

/** Break-even per leg for each entry size played, at the median multiplier actually paid. */
export function breakEvenRows(entries: EntryPlayed[]): BreakEvenRow[] {
  const bySize = new Map<number, number[]>();
  for (const e of entries) {
    if (!(e.legs >= 1) || !(e.multiplier > 0)) continue;
    bySize.set(e.legs, [...(bySize.get(e.legs) ?? []), e.multiplier]);
  }
  return [...bySize.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([legs, ms]) => {
      const s = [...ms].sort((a, b) => a - b);
      const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
      return { label: legs === 1 ? "single" : `${legs}-pick`, entries: s.length, medianMultiplier: median, breakEvenPerLeg: breakEvenPerLeg(median, legs)! };
    });
}

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
  /** Null: timed out or failed, cost unknown (such a row has no balance either). */
  credits: number | null;
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
    const prevCost = prev.credits ?? 0;
    const curCost = cur.credits ?? 0;
    if (cur.remaining! > prev.remaining! + prevCost + curCost) continue; // reset
    gap += prev.remaining! - cur.remaining! - curCost;
  }
  return gap;
}

/** One line for the Over-vs-books rule's state. */
export function overStatusLine(s: OverGapStatus): string {
  if (s.state === "none") return "no flag — the cumulative interval has never excluded zero";
  const side = s.direction === "below" ? "Over below the books" : "Over above the books";
  const after = s.after ? `; weeks after alone ${fmtInterval(s.after.gapPts, s.after.interval, 1, " pts")}` : "";
  if (s.state === "confirmed") return `CONFIRMED — ${side}; first crossed week of ${s.crossedWeek}, held over ${s.weeksAfter} later weeks${after}`;
  return `FLAGGED — ${side}, first crossed week of ${s.crossedWeek}; ${s.weeksAfter} of ${OVER_CONFIRM_WEEKS} later weeks needed to confirm${after}`;
}

/** A per-book cell with fewer props than this gets a warning beside it (set 2026-10-27). */
export const SMALL_CELL_N = 5;

/** One RB-out table cell: "moved/props mean-line-change", warned when thin. */
export function changeCell(v: { props: number; moved: number; meanLineChange: number | null } | undefined): string {
  if (!v) return "—";
  const mean = v.meanLineChange == null ? "—" : `${v.meanLineChange >= 0 ? "+" : "−"}${Math.abs(v.meanLineChange).toFixed(2)}`;
  return `${v.moved}/${v.props} ${mean}${v.props < SMALL_CELL_N ? " ⚠" : ""}`;
}

/** "+0.42 pts [−1.10, +1.95]" with a marker when the interval excludes zero. */
export function fmtInterval(x: number, iv: Interval | null, digits: number, unit = ""): string {
  const s = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
  const flag = iv && (iv.lo > 0 || iv.hi < 0) ? "  ◀ excludes zero" : "";
  return `${s(x)}${unit}${iv ? ` [${s(iv.lo)}, ${s(iv.hi)}]` : ""}${flag}`;
}
