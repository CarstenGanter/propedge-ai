import { describe, expect, it } from "vitest";
import {
  computeRecord,
  profitLossBy,
  summarizeBankroll,
  type BankrollRecord,
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
