import { describe, expect, it } from "vitest";
import {
  breakEvenRows,
  changeCell,
  easternMidnight,
  fmtInterval,
  greenSummary,
  isGreen,
  nflWeekStart,
  sigmaVerdict,
  unaccountedCredits,
  type GreenPick,
  type SigmaSample,
} from "./weeklySummary";

const sample = (s: SigmaSample["sample"], lo: number, hi: number): SigmaSample => ({
  sample: s, n: 100, games: 20, diff: (lo + hi) / 2, interval: { lo, hi }, eceCurrent: 3, eceFitted: 3, gate: null,
});

describe("sigmaVerdict", () => {
  it("keeps the fitted σ while the pooled interval includes or sits below zero", () => {
    expect(sigmaVerdict([sample("held-out", -0.0014, 0.002), sample("pooled", -0.0012, 0.0018)]).verdict).toBe("keep");
    expect(sigmaVerdict([sample("pooled", -0.003, -0.001)]).verdict).toBe("keep");
  });

  it("says REVERT only when the pooled interval sits above zero", () => {
    const v = sigmaVerdict([sample("held-out", -0.0014, 0.002), sample("pooled", 0.0003, 0.004)]);
    expect(v.verdict).toBe("REVERT");
    expect(v.reason).toContain("pooled");
  });

  it("lets no separate sample trigger anything — not after-fit, not the fit week", () => {
    const v = sigmaVerdict([sample("fit-week", 0.001, 0.005), sample("after-fit", 0.0003, 0.004), sample("held-out", 0.0001, 0.002), sample("pooled", -0.0002, 0.003)]);
    expect(v.verdict).toBe("keep");
  });

  it("keeps when there is no pooled interval", () => {
    expect(sigmaVerdict([{ ...sample("pooled", 0, 0), n: 0, interval: null, diff: null }]).verdict).toBe("keep");
    expect(sigmaVerdict([sample("after-fit", 0.001, 0.004)]).verdict).toBe("keep");
  });
});

describe("nflWeekStart", () => {
  it("is the latest Wednesday 00:00 Eastern, so a Monday-night or Tuesday run covers Thursday to Monday", () => {
    const wed = "2026-10-14T04:00:00.000Z"; // Wed Oct 14, 00:00 EDT
    expect(nflWeekStart(new Date("2026-10-20T03:45:00Z")).toISOString()).toBe(wed); // Mon 11:45pm ET
    expect(nflWeekStart(new Date("2026-10-20T15:00:00Z")).toISOString()).toBe(wed); // Tue
    expect(nflWeekStart(new Date("2026-10-14T04:00:00Z")).toISOString()).toBe(wed); // the instant itself
    expect(nflWeekStart(new Date("2026-10-14T03:59:00Z")).toISOString()).toBe("2026-10-07T04:00:00.000Z"); // Tue 11:59pm ET
  });

  it("follows the clock change", () => {
    expect(easternMidnight("2026-11-04").toISOString()).toBe("2026-11-04T05:00:00.000Z"); // EST after Nov 1
    expect(nflWeekStart(new Date("2026-11-10T12:00:00Z")).toISOString()).toBe("2026-11-04T05:00:00.000Z");
  });
});

describe("unaccountedCredits", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 19, 12, m));
  it("is zero when each logged cost explains the drop in balance", () => {
    expect(unaccountedCredits([{ at: at(0), credits: 6, remaining: 203 }, { at: at(5), credits: 4, remaining: 199 }])).toBe(0);
  });

  it("finds credits spent between two logged calls by something that never logged", () => {
    expect(unaccountedCredits([{ at: at(0), credits: 6, remaining: 209 }, { at: at(5), credits: 4, remaining: 199 }])).toBe(6);
  });

  it("does not count the monthly reset, and lets overlapping requests cancel", () => {
    expect(unaccountedCredits([{ at: at(0), credits: 3, remaining: 12 }, { at: at(5), credits: 6, remaining: 494 }])).toBe(0);
    // two concurrent calls whose headers arrive out of order
    expect(unaccountedCredits([{ at: at(0), credits: 1, remaining: 100 }, { at: at(1), credits: 3, remaining: 96 }, { at: at(1), credits: 1, remaining: 99 }, { at: at(2), credits: 2, remaining: 94 }])).toBe(0);
  });
});

describe("unaccountedCredits with a timed-out call", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 25, 12, m));
  it("shows a timed-out call that was charged as unaccounted — its cost was never known", () => {
    // 3 credits charged for a request that timed out (no balance header came back).
    expect(unaccountedCredits([{ at: at(0), credits: 6, remaining: 190 }, { at: at(1), credits: null, remaining: null }, { at: at(2), credits: 1, remaining: 186 }])).toBe(3);
  });
});

describe("fmtInterval", () => {
  it("marks an interval that excludes zero", () => {
    expect(fmtInterval(1.23, { lo: 0.2, hi: 2.4 }, 1, " pts")).toBe("+1.2 pts [+0.2, +2.4]  ◀ excludes zero");
    expect(fmtInterval(-0.4, { lo: -1.1, hi: 0.3 }, 1)).toBe("−0.4 [−1.1, +0.3]");
  });
});

describe("isGreen", () => {
  const base = { reliable: true, priced: true };
  it("needs books × payout of at least 1.02", () => {
    expect(isGreen({ ...base, books: 0.55, payout: 1.86 })).toBe(true); // 1.023
    expect(isGreen({ ...base, books: 0.533, payout: 1.86 })).toBe(false); // 0.991, Prescott on 2026-10-26
  });
  it("is never green without Underdog's payout entered — unpriced, not the standard 1.87x", () => {
    expect(isGreen({ ...base, books: 0.7, payout: null })).toBe(false);
    expect(isGreen({ ...base, books: 0.546, payout: 1.87 })).toBe(true); // 1.021
  });
  it("is never green on a thin price or without one", () => {
    expect(isGreen({ ...base, books: 0.7, payout: 1.87, reliable: false })).toBe(false);
    expect(isGreen({ ...base, books: 0.7, payout: 1.87, priced: false })).toBe(false);
    expect(isGreen({ ...base, books: null, payout: 1.87 })).toBe(false);
    expect(isGreen({ books: 0.7, payout: 1.87, reliable: null, priced: null })).toBe(true);
  });
});

describe("greenSummary", () => {
  const pick = (cluster: string, hit: boolean, entry: number | null, close: number | null): GreenPick => ({ cluster, hit, books: 0.6, entry, close });
  it("counts hits and the books' mean, and leaves picks without a close out of CLV", () => {
    const s = greenSummary([pick("a", true, 0.6, 0.62), pick("b", false, 0.6, 0.58), pick("c", true, 0.6, null)]);
    expect(s.n).toBe(3);
    expect(s.hits).toBe(2);
    expect(s.meanBooks).toBeCloseTo(0.6);
    expect(s.clv.n).toBe(2);
    expect(s.clv.missing).toBe(1);
    expect(s.clv.meanPts).toBeCloseTo(0);
    expect(s.clv.beatPct).toBe(50);
  });
  it("gives no interval from one game", () => {
    expect(greenSummary([pick("a", true, 0.6, 0.65), pick("a", true, 0.6, 0.64)]).clv.interval).toBeNull();
  });
  it("is empty without picks", () => {
    const s = greenSummary([]);
    expect(s.hitRate).toBeNull();
    expect(s.clv.meanPts).toBeNull();
  });
});

describe("changeCell", () => {
  it("shows moved/props and the mean line change, warning under 5 props", () => {
    expect(changeCell({ props: 3, moved: 1, meanLineChange: -0.333 })).toBe("1/3 −0.33 ⚠");
    expect(changeCell({ props: 12, moved: 4, meanLineChange: 0.5 })).toBe("4/12 +0.50");
    expect(changeCell({ props: 5, moved: 0, meanLineChange: null })).toBe("0/5 —");
    expect(changeCell(undefined)).toBe("—");
  });
});

describe("breakEvenRows", () => {
  it("reads each entry size at the median multiplier paid", () => {
    const rows = breakEvenRows([
      { legs: 2, multiplier: 3.5 },
      { legs: 2, multiplier: 3.47 },
      { legs: 2, multiplier: 1.49 },
      { legs: 3, multiplier: 6.5 },
      { legs: 1, multiplier: 2 },
    ]);
    expect(rows.map((r) => r.label)).toEqual(["single", "2-pick", "3-pick"]);
    expect(rows[0].breakEvenPerLeg).toBeCloseTo(0.5);
    expect(rows[1].medianMultiplier).toBe(3.47);
    expect(rows[1].breakEvenPerLeg).toBeCloseTo(Math.sqrt(1 / 3.47));
    expect(rows[2].breakEvenPerLeg).toBeCloseTo(Math.pow(1 / 6.5, 1 / 3));
  });
  it("sets each size's standard rung beside it, from the shared ladder", () => {
    const rows = breakEvenRows([{ legs: 1, multiplier: 2 }, { legs: 2, multiplier: 3.47 }, { legs: 3, multiplier: 4.91 }]);
    expect(rows.map((r) => r.standardMultiplier)).toEqual([1.87, 3.5, 6.5]);
    expect(rows[2].standardBreakEven).toBeCloseTo(Math.pow(1 / 6.5, 1 / 3)); // 53.6%, the Analytics bar
    expect(rows[2].breakEvenPerLeg).toBeCloseTo(Math.pow(1 / 4.91, 1 / 3)); // 58.8%, what the 3-picks played needed
  });
  it("skips entries with no multiplier or legs", () => {
    expect(breakEvenRows([{ legs: 0, multiplier: 3 }, { legs: 2, multiplier: 0 }])).toEqual([]);
  });
});
