import { describe, expect, it } from "vitest";
import { summarizeUsage, vacatedTargetShare } from "./usage";
import type { SnapRow, WeeklyStatRow } from "@/lib/providers/live/nflverse";

const wk = (week: number, over: Partial<WeeklyStatRow> = {}): WeeklyStatRow => ({
  gsisId: "p1",
  week,
  team: "KC",
  opponent: "DEN",
  position: "WR",
  targets: 6,
  targetShare: 0.25,
  airYardsShare: 0.3,
  receptions: 4,
  receivingYards: 55,
  carries: 0,
  rushingYards: 0,
  ...over,
});

const snap = (week: number, pct: number | null, over: Partial<SnapRow> = {}): SnapRow => ({
  pfrId: "P1",
  week,
  team: "KC",
  position: "WR",
  offensePct: pct,
  offenseSnaps: 50,
  ...over,
});

describe("summarizeUsage", () => {
  it("averages snap and target share over the recent window", () => {
    const u = summarizeUsage(
      [wk(4, { targetShare: 0.3 }), wk(3, { targetShare: 0.2 })],
      [snap(4, 0.9), snap(3, 0.8)],
    );
    expect(u.snapPct).toBeCloseTo(0.85, 6);
    expect(u.targetShare).toBeCloseTo(0.25, 6);
    expect(u.latestWeek).toBe(4);
    expect(u.weeksUsed).toBe(2);
  });

  it("reads the most recent weeks regardless of row order", () => {
    const u = summarizeUsage([wk(1), wk(3), wk(2)], [snap(1, 0.2), snap(3, 0.9), snap(2, 0.5)], 1);
    expect(u.snapPct).toBeCloseTo(0.9, 6); // week 3 only
    expect(u.latestWeek).toBe(3);
  });

  it("detects a promotion into a bigger role", () => {
    // Recent four weeks at ~85%, the four before at ~35%.
    const snaps = [
      snap(8, 0.86), snap(7, 0.84), snap(6, 0.85), snap(5, 0.85),
      snap(4, 0.35), snap(3, 0.36), snap(2, 0.34), snap(1, 0.35),
    ];
    expect(summarizeUsage([], snaps).trend).toBe("up");
  });

  it("detects a player losing snaps", () => {
    const snaps = [
      snap(8, 0.4), snap(7, 0.4), snap(6, 0.4), snap(5, 0.4),
      snap(4, 0.9), snap(3, 0.9), snap(2, 0.9), snap(1, 0.9),
    ];
    expect(summarizeUsage([], snaps).trend).toBe("down");
  });

  it("does not call a small wobble a trend", () => {
    const snaps = [snap(8, 0.82), snap(7, 0.8), snap(6, 0.78), snap(5, 0.8), snap(4, 0.77), snap(3, 0.79)];
    expect(summarizeUsage([], snaps).trend).toBe("steady");
  });

  it("treats a first-ever sample as steady rather than a trend", () => {
    expect(summarizeUsage([], [snap(1, 0.9)]).trend).toBe("steady");
  });

  it("returns nulls instead of guessing when there is no data", () => {
    const u = summarizeUsage([], []);
    expect(u.snapPct).toBeNull();
    expect(u.targetShare).toBeNull();
    expect(u.trend).toBeNull();
    expect(u.weeksUsed).toBe(0);
    expect(u.latestWeek).toBeNull();
  });

  it("ignores weeks with a missing snap percentage", () => {
    const u = summarizeUsage([], [snap(3, null), snap(2, 0.6), snap(1, 0.4)]);
    expect(u.snapPct).toBeCloseTo(0.5, 6);
  });
});

describe("vacatedTargetShare", () => {
  const weekly: WeeklyStatRow[] = [
    wk(4, { gsisId: "wr1", targetShare: 0.3 }),
    wk(3, { gsisId: "wr1", targetShare: 0.28 }),
    wk(4, { gsisId: "wr4", targetShare: 0.02 }),
    wk(3, { gsisId: "wr4", targetShare: 0.03 }),
  ];

  it("sizes an absence by the share the player actually commanded", () => {
    const big = vacatedTargetShare([{ name: "Star WR", gsisId: "wr1" }], weekly);
    expect(big.share).toBeCloseTo(0.29, 6);
    const small = vacatedTargetShare([{ name: "Depth WR", gsisId: "wr4" }], weekly);
    expect(small.share).toBeCloseTo(0.025, 6);
    expect(big.share).toBeGreaterThan(small.share * 5);
  });

  it("sums multiple absences, biggest first", () => {
    const v = vacatedTargetShare(
      [{ name: "Depth WR", gsisId: "wr4" }, { name: "Star WR", gsisId: "wr1" }],
      weekly,
    );
    expect(v.share).toBeCloseTo(0.315, 6);
    expect(v.contributors[0].name).toBe("Star WR");
  });

  it("excludes unmatched players rather than imputing a share", () => {
    const v = vacatedTargetShare([{ name: "Unknown", gsisId: null }], weekly);
    expect(v.share).toBe(0);
    expect(v.contributors).toHaveLength(0);
  });

  it("ignores an absent player with no recorded targets", () => {
    const v = vacatedTargetShare([{ name: "Lineman", gsisId: "ol1" }], weekly);
    expect(v.share).toBe(0);
  });
});
