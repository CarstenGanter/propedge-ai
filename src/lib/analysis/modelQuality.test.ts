import { describe, expect, it } from "vitest";
import {
  brierScore,
  logLoss,
  brierSkillScore,
  reliabilityCurve,
  clvSummary,
  clvDayAndToDate,
  type CalibrationItem,
} from "./modelQuality";

describe("brier & log loss", () => {
  it("returns null on empty input", () => {
    expect(brierScore([])).toBeNull();
    expect(logLoss([])).toBeNull();
  });

  it("scores a perfect forecaster ~0", () => {
    const items: CalibrationItem[] = [
      { p: 1, hit: true },
      { p: 0, hit: false },
    ];
    expect(brierScore(items)).toBeCloseTo(0, 6);
  });

  it("scores a coin-flip forecaster at 0.25", () => {
    const items: CalibrationItem[] = [
      { p: 0.5, hit: true },
      { p: 0.5, hit: false },
    ];
    expect(brierScore(items)).toBeCloseTo(0.25, 6);
  });

  it("punishes a confidently wrong call in log loss", () => {
    const confidentWrong = logLoss([{ p: 0.99, hit: false }])!;
    const unsure = logLoss([{ p: 0.5, hit: false }])!;
    expect(confidentWrong).toBeGreaterThan(unsure);
  });

  it("brier skill score is ~0 for coin flips and positive for a good model", () => {
    expect(brierSkillScore([{ p: 0.5, hit: true }, { p: 0.5, hit: false }])).toBeCloseTo(0, 6);
    const good = brierSkillScore([
      { p: 0.8, hit: true },
      { p: 0.8, hit: true },
      { p: 0.8, hit: true },
      { p: 0.8, hit: false },
    ])!;
    expect(good).toBeGreaterThan(0);
  });
});

describe("reliability curve", () => {
  it("bins predictions and reports realized rates", () => {
    const items: CalibrationItem[] = [
      { p: 0.55, hit: true },
      { p: 0.58, hit: false },
      { p: 0.82, hit: true },
      { p: 0.85, hit: true },
    ];
    const curve = reliabilityCurve(items);
    const band5060 = curve.find((b) => b.bucket === "50-60%")!;
    expect(band5060.count).toBe(2);
    expect(band5060.actual).toBe(50);
    const band80100 = curve.find((b) => b.bucket === "80-100%")!;
    expect(band80100.count).toBe(2);
    expect(band80100.actual).toBe(100);
  });
});

describe("clv summary", () => {
  it("computes average CLV and beat-close rate", () => {
    const s = clvSummary([
      { entryProb: 0.5, closingProb: 0.55 }, // +5pts (beat close)
      { entryProb: 0.6, closingProb: 0.58 }, // -2pts
      { entryProb: 0.5, closingProb: 0.5 }, // neutral
    ]);
    expect(s.count).toBe(3);
    expect(s.avgClv).toBeCloseTo(1, 2); // mean of +5, -2, 0 = +1 pt
    expect(s.positive).toBe(1);
    expect(s.negative).toBe(1);
    expect(s.neutral).toBe(1);
    expect(s.beatCloseRate).toBeCloseTo(33.3, 1);
  });

  it("ignores items missing a closing line", () => {
    const s = clvSummary([{ entryProb: 0.5, closingProb: NaN }]);
    expect(s.count).toBe(0);
  });

  it("leaves voided picks out: a line that moves on an inactive player isn't market disagreement", () => {
    const s = clvSummary([
      { entryProb: 0.5, closingProb: 0.52 },
      { entryProb: 0.54, closingProb: 0.52, status: "void" },
    ]);
    expect(s.count).toBe(1);
    expect(s.avgClv).toBeCloseTo(2, 2);
    expect(s.negative).toBe(0);
    expect(s.voidExcluded).toBe(1);
  });
});

describe("clv for a day and to date", () => {
  const items = [
    { date: "2026-10-22", entryProb: 0.5, closingProb: 0.51 },
    { date: "2026-10-25", entryProb: 0.5, closingProb: 0.49 },
    { date: "2026-10-25", entryProb: 0.5, closingProb: 0.47, status: "void" },
    { date: "2026-10-26", entryProb: 0.5, closingProb: 0.6 },
  ];

  it("reports the day next to everything through that day, never after it", () => {
    const r = clvDayAndToDate(items, "2026-10-25");
    expect(r.day.count).toBe(1);
    expect(r.day.avgClv).toBeCloseTo(-1, 2);
    expect(r.toDate.count).toBe(2); // the 26th is not in it; the void is in neither
    expect(r.toDate.avgClv).toBeCloseTo(0, 2);
    expect(r.toDate.beatCloseRate).toBeCloseTo(50, 1);
  });
});
