import { describe, expect, it } from "vitest";
import { previousWeek, topLine, trendTable, upsertWeek, type WeekRecord } from "./weeklyTrends";

const rec = (week: string, o: Partial<WeekRecord> = {}): WeekRecord => ({
  week,
  runAt: `${week}T20:00:00Z`,
  primarySkillPct: -0.05,
  liveVersion: "v1.7.0",
  liveSkillPct: -0.02,
  overGapPts: { "Underdog hist": -2.7, "PrizePicks hist": -3.7 },
  overFlags: { "Underdog hist": { state: "none", direction: null }, "PrizePicks hist": { state: "flagged", direction: "below" } },
  sigmaPooled: -0.0002,
  heldOutEce: { fitted: 3.62, current: 4.39 },
  sigmaVerdict: "keep",
  priceVerdict: "keep",
  credits: 132,
  greenClv: { picks: 36, withClose: 2, meanPts: 0.23 },
  unmatched: 0,
  pending: 0,
  failedJobs: [],
  ...o,
});

describe("upsertWeek / previousWeek", () => {
  it("replaces a rerun in the same week and keeps weeks in order", () => {
    const h = upsertWeek(upsertWeek(upsertWeek([], rec("2026-10-21")), rec("2026-10-14")), rec("2026-10-21", { credits: 140 }));
    expect(h.map((x) => x.week)).toEqual(["2026-10-14", "2026-10-21"]);
    expect(h[1].credits).toBe(140);
  });
  it("finds the latest earlier week, never the same one", () => {
    const h = [rec("2026-10-07"), rec("2026-10-14"), rec("2026-10-21")];
    expect(previousWeek(h, "2026-10-21")?.week).toBe("2026-10-14");
    expect(previousWeek(h, "2026-10-07")).toBeNull();
  });
});

describe("trendTable", () => {
  it("shows the last six weeks side by side", () => {
    const h = ["09-09", "09-16", "09-23", "09-30", "10-07", "10-14", "10-21"].map((d) => rec(`2026-${d}`));
    const t = trendTable(h);
    expect(t[0]).toContain("2026-09-16");
    expect(t[0]).not.toContain("2026-09-09");
    expect(t.find((l) => l.includes("Over gap PrizePicks hist"))).toContain("−3.7 pts");
    expect(t.find((l) => l.includes("held-out ECE"))).toContain("3.62/4.39");
  });
  it("says so when nothing is recorded", () => {
    expect(trendTable([])).toEqual(["  no weeks recorded yet"]);
  });
});

describe("topLine", () => {
  it("is at most four lines", () => {
    expect(topLine(rec("2026-10-21"), null).length).toBeLessThanOrEqual(4);
  });
  it("lists standing flags in the first week on record", () => {
    expect(topLine(rec("2026-10-21"), null)[0]).toBe("Flags (first week on record): PrizePicks hist FLAGGED (Over below the books)");
  });
  it("names new, cleared and confirmed flags against last week", () => {
    const prev = rec("2026-10-14", {
      overFlags: { "Underdog hist": { state: "flagged", direction: "below" }, "PrizePicks hist": { state: "none", direction: null } },
    });
    expect(topLine(rec("2026-10-21"), prev)[0]).toBe("Flags: CLEARED Underdog hist; NEW PrizePicks hist FLAGGED (Over below the books)");
    const confirmed = rec("2026-10-21", { overFlags: { "Underdog hist": { state: "none", direction: null }, "PrizePicks hist": { state: "confirmed", direction: "below" } } });
    const lines = topLine(confirmed, rec("2026-10-14"));
    expect(lines[0]).toContain("CONFIRMED PrizePicks hist");
    expect(lines[3]).toContain("PrizePicks hist Over flag confirmed");
  });
  it("says no change when the flags held", () => {
    expect(topLine(rec("2026-10-21"), rec("2026-10-14"))[0]).toBe("Flags: no change since 2026-10-14 (PrizePicks hist FLAGGED (Over below the books))");
  });
  it("calls out a verdict change and a REVERT", () => {
    const lines = topLine(rec("2026-10-21", { sigmaVerdict: "REVERT" }), rec("2026-10-14"));
    expect(lines[1]).toBe("Verdicts: σ REVERT, held-out price test keep — CHANGED from σ keep, price test keep");
    expect(lines[3]).toContain("REVERT");
    expect(topLine(rec("2026-10-21"), rec("2026-10-14"))[1]).toContain("(unchanged)");
  });
  it("gives the green-pick CLV headline", () => {
    expect(topLine(rec("2026-10-21"), null)[2]).toBe("Green-pick CLV: +0.23 pts on 2 of 36 green picks (the rest have no stored close)");
    expect(topLine(rec("2026-10-21", { greenClv: { picks: 0, withClose: 0, meanPts: null } }), null)[2]).toBe("Green-pick CLV: no green picks graded");
  });
  it("lists what needs action, or none", () => {
    expect(topLine(rec("2026-10-21"), null)[3]).toBe("Action: none");
    const a = topLine(rec("2026-10-21", { failedJobs: ["latency"], unmatched: 2, pending: 5 }), null)[3];
    expect(a).toBe("Action: rerun — failed: latency; 5 props not graded yet — rerun after nflverse posts; 2 unmatched props — check skill.log for names to alias");
  });
});
