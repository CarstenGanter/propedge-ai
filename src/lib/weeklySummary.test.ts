import { describe, expect, it } from "vitest";
import { easternMidnight, fmtInterval, nflWeekStart, sigmaVerdict, unaccountedCredits, type SigmaSample } from "./weeklySummary";

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
