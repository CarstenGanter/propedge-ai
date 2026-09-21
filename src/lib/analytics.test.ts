import { describe, expect, it } from "vitest";
import {
  assessRate,
  computeRecord,
  defaultSport,
  filterRecords,
  profitLossBy,
  significantGroups,
  summarizeBankroll,
  wilsonInterval,
  type BankrollRecord,
  type GroupedRecord,
  type PickRecord,
} from "./analytics";
import { computeCalibration } from "./analysis/calibration";

const pick = (over: Partial<PickRecord>): PickRecord => ({
  sport: "NBA",
  league: "NBA",
  propType: "Points",
  direction: "OVER",
  confidenceScore: 70,
  status: "pending",
  date: "2026-06-30",
  ...over,
});

describe("computeRecord", () => {
  it("counts outcomes and hit rate over decided picks", () => {
    const r = computeRecord([
      pick({ status: "hit" }),
      pick({ status: "hit" }),
      pick({ status: "miss" }),
      pick({ status: "push" }),
      pick({ status: "pending" }),
    ]);
    expect(r.hits).toBe(2);
    expect(r.misses).toBe(1);
    expect(r.pushes).toBe(1);
    expect(r.pending).toBe(1);
    expect(r.hitRate).toBeCloseTo((2 / 3) * 100, 5);
  });
});

describe("summarizeBankroll", () => {
  const entries: BankrollRecord[] = [
    { date: "2026-06-30", stake: 5, payout: 10, profitLoss: 5, status: "won" },
    { date: "2026-06-30", stake: 5, payout: 0, profitLoss: -5, status: "lost" },
    { date: "2026-06-30", stake: 0, payout: 0, profitLoss: 20, status: "won", entryType: "manual_adjustment" },
  ];

  it("computes P/L, ROI and win rate excluding manual adjustments", () => {
    const s = summarizeBankroll(entries, 100);
    expect(s.profitLoss).toBe(20); // 5 - 5 + 20
    expect(s.staked).toBe(10);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(50);
    expect(s.currentBankroll).toBe(120);
  });
});

describe("profitLossBy", () => {
  it("groups P/L and computes ROI", () => {
    const rows = profitLossBy(
      [
        { date: "d", stake: 5, payout: 10, profitLoss: 5, status: "won", sport: "NBA" },
        { date: "d", stake: 5, payout: 0, profitLoss: -5, status: "lost", sport: "NBA" },
        { date: "d", stake: 5, payout: 15, profitLoss: 10, status: "won", sport: "MLB" },
      ],
      (e) => e.sport,
    );
    const nba = rows.find((r) => r.key === "NBA")!;
    expect(nba.profitLoss).toBe(0);
    expect(nba.roi).toBe(0);
  });
});

describe("computeCalibration", () => {
  it("buckets predicted vs actual", () => {
    const points = computeCalibration([
      pick({ confidenceScore: 72, status: "hit" }),
      pick({ confidenceScore: 74, status: "miss" }),
    ]);
    const b = points.find((p) => p.bucket === "70-79")!;
    expect(b.count).toBe(2);
    expect(b.actual).toBe(50);
  });
});

describe("filterRecords", () => {
  const rec = (over: Partial<PickRecord>): PickRecord => ({
    sport: "NFL",
    league: "NFL",
    propType: "Receiving Yards",
    direction: "OVER",
    confidenceScore: 60,
    status: "hit",
    date: "2026-09-13",
    ...over,
  });
  const records: PickRecord[] = [
    rec({ placedReal: true }),
    rec({ placedReal: false }),
    rec({ sport: "MLB", propType: "Hits", placedReal: true }),
    rec({ placedReal: true, isDemo: true }),
  ];

  it("defaults to every real pick across sports", () => {
    expect(filterRecords(records, { scope: "all", sport: "All" })).toHaveLength(3);
  });

  it("keeps only picks the user marked as taken", () => {
    const mine = filterRecords(records, { scope: "mine", sport: "All" });
    expect(mine).toHaveLength(2);
    expect(mine.every((r) => r.placedReal)).toBe(true);
  });

  it("narrows to one sport", () => {
    expect(filterRecords(records, { scope: "all", sport: "NFL" })).toHaveLength(2);
    expect(filterRecords(records, { scope: "mine", sport: "NFL" })).toHaveLength(1);
    expect(filterRecords(records, { scope: "mine", sport: "MLB" })).toHaveLength(1);
  });

  it("excludes demo picks so synthetic results never inflate a hit rate", () => {
    expect(filterRecords(records, { scope: "mine", sport: "All" }).some((r) => r.isDemo)).toBe(false);
    expect(filterRecords(records, { scope: "mine", sport: "All", includeDemo: true })).toHaveLength(3);
  });
});

describe("wilsonInterval", () => {
  it("matches published values", () => {
    // Standard worked example: 22 of 37 -> roughly 43.5% to 73.7%.
    const w = wilsonInterval(22, 37)!;
    expect(w.low).toBeCloseTo(43.5, 1);
    expect(w.high).toBeCloseTo(73.7, 1);
  });

  it("stays inside [0,100] where the normal approximation would not", () => {
    const perfect = wilsonInterval(7, 7)!;
    expect(perfect.high).toBeCloseTo(100, 6);
    expect(perfect.low).toBeGreaterThan(0);
    expect(perfect.low).toBeLessThan(100);

    const none = wilsonInterval(0, 5)!;
    expect(none.low).toBeCloseTo(0, 6);
    expect(none.high).toBeLessThan(100);
  });

  it("narrows as evidence accumulates", () => {
    const small = wilsonInterval(6, 10)!;
    const large = wilsonInterval(600, 1000)!;
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("rejects impossible inputs", () => {
    expect(wilsonInterval(3, 0)).toBeNull();
    expect(wilsonInterval(5, 3)).toBeNull();
    expect(wilsonInterval(-1, 10)).toBeNull();
  });
});

describe("assessRate", () => {
  const BAR = 55.03; // 3-leg at 6x

  it("refuses to call an edge the sample cannot support", () => {
    // The board's actual NFL record: above the bar on paper, interval spans it.
    const a = assessRate(22, 15, BAR);
    expect(a.hitRate).toBeCloseTo(59.5, 1);
    expect(a.clearsBar).toBe(false);
    expect(a.belowBar).toBe(false);
    expect(a.separatesFromChance).toBe(false);
  });

  it("confirms an edge once the whole interval clears the bar", () => {
    const a = assessRate(620, 380, BAR);
    expect(a.clearsBar).toBe(true);
    expect(a.separatesFromChance).toBe(true);
  });

  it("reports an evidenced losing record too", () => {
    const a = assessRate(380, 620, BAR);
    expect(a.belowBar).toBe(true);
    expect(a.clearsBar).toBe(false);
  });

  it("handles a record with nothing decided", () => {
    const a = assessRate(0, 0, BAR);
    expect(a.hitRate).toBeNull();
    expect(a.interval).toBeNull();
    expect(a.clearsBar).toBe(false);
  });
});

describe("significantGroups", () => {
  const g = (key: string, hits: number, misses: number): GroupedRecord => ({
    key,
    record: {
      total: hits + misses,
      settled: hits + misses,
      hits,
      misses,
      pushes: 0,
      voids: 0,
      pending: 0,
      hitRate: hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0,
    },
  });

  it("finds nothing separating in a board of small samples", () => {
    // Shapes taken from the real board: nothing here beats a coin flip.
    const r = significantGroups([g("Receptions", 12, 6), g("Receiving Yards", 3, 4), g("Pass TDs", 2, 2)]);
    expect(r.separating).toEqual([]);
    expect(r.tested).toBe(2); // Pass TDs has too few decided to test
    expect(r.nearest?.key).toBe("Receptions");
  });

  it("reports a group whose interval clears 50%", () => {
    const r = significantGroups([g("Receptions", 40, 10), g("Pass TDs", 5, 5)]);
    expect(r.separating.map((s) => s.key)).toEqual(["Receptions"]);
  });

  it("ignores groups below the minimum sample", () => {
    expect(significantGroups([g("Rush Attempts", 3, 0)]).tested).toBe(0);
  });
});

describe("defaultSport", () => {
  const r = (sport: string, date: string, placedReal = false): PickRecord =>
    pick({ sport, date, placedReal });

  it("picks the sport actually being bet, not the biggest pile of picks", () => {
    const records = [
      r("MLB", "2026-07-02"),
      r("MLB", "2026-07-03"),
      r("MLB", "2026-07-04"),
      r("NFL", "2026-09-17", true),
    ];
    expect(defaultSport(records)).toBe("NFL");
  });

  it("falls back to the most-picked sport when nothing was placed", () => {
    expect(defaultSport([r("MLB", "2026-07-02"), r("MLB", "2026-07-03"), r("NFL", "2026-09-17")])).toBe("MLB");
  });

  it("ignores demo rows and copes with an empty board", () => {
    expect(defaultSport([])).toBe("All");
    expect(defaultSport([pick({ sport: "WNBA", isDemo: true })])).toBe("All");
  });
});
