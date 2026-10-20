import { describe, expect, it } from "vitest";
import { calibrationSummary, excessByVenueGap, reliabilityTable, venueGapBucket, type VenueItem } from "./venueCalibration";

const it_ = (p: number, hit: boolean, gap = 0, priced = true, cluster = "g"): VenueItem => ({ p, hit, gap, priced, cluster });

describe("calibrationSummary", () => {
  it("scores a perfectly calibrated bin as zero calibration error", () => {
    const xs = [it_(0.5, true), it_(0.5, false), it_(0.5, true), it_(0.5, false)];
    const s = calibrationSummary(xs)!;
    expect(s.ecePts).toBeCloseTo(0, 12);
    expect(s.brier).toBeCloseTo(0.25, 12);
    expect(s.logLoss).toBeCloseTo(Math.log(2), 12);
  });

  it("measures overconfidence as calibration error", () => {
    // Said 85%, hit 50%: 35 points off.
    expect(calibrationSummary([it_(0.85, true), it_(0.85, false)])!.ecePts).toBeCloseTo(35, 10);
  });
});

describe("reliabilityTable", () => {
  it("bins by 5 points and reports hits minus expected", () => {
    const rows = reliabilityTable([it_(0.52, true, 0, true, "a"), it_(0.53, false, 0, true, "b"), it_(0.86, false, 0, true, "c")], 0.05, { reps: 50 });
    expect(rows.map((r) => r.label)).toEqual(["50–55%", "85–90%"]);
    expect(rows[0].excessPts).toBeCloseTo(((1 - 0.52) + (0 - 0.53)) / 2 * 100, 10);
  });
});

describe("venue-gap buckets", () => {
  it("puts lines beyond the books' range in their own bucket whatever the gap", () => {
    expect(venueGapBucket({ gap: 11, priced: false })).toBe("beyond the books' lines");
    expect(venueGapBucket({ gap: 1, priced: true })).toBe("soft by under 2");
    expect(venueGapBucket({ gap: -2, priced: true })).toBe("tough by 2+");
    expect(venueGapBucket({ gap: 0, priced: true })).toBe("same line");
  });

  it("orders buckets from tough to soft, unpriced last", () => {
    const rows = excessByVenueGap([it_(0.85, false, 11, false, "a"), it_(0.5, true, 0, true, "b"), it_(0.55, true, -1, true, "c")], { reps: 50 });
    expect(rows.map((r) => r.label)).toEqual(["tough by under 2", "same line", "beyond the books' lines"]);
    expect(rows[2].excessPts).toBeCloseTo(-85, 10);
  });
});
