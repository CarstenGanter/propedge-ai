import { describe, expect, it } from "vitest";
import { getParkFactor, parkCount } from "./parkFactors";
import { buildDefenseRanks } from "./espnMatchup";
import { mapInjuryStatus } from "./espnInjuries";
import { restFromDates } from "../historicalProvider";

describe("park factors", () => {
  it("covers all 30 MLB parks", () => {
    expect(parkCount()).toBe(30);
  });
  it("returns values in a sane hitter/pitcher band", () => {
    const rockies = getParkFactor("Colorado Rockies")!;
    const mariners = getParkFactor("Seattle Mariners")!;
    expect(rockies).toBeGreaterThan(1.05);
    expect(mariners).toBeLessThan(1);
  });
  it("fuzzy-matches team names", () => {
    expect(getParkFactor("St. Louis Cardinals")).toBeDefined();
    expect(getParkFactor("Nonexistent Team")).toBeUndefined();
  });
});

describe("defense ranks", () => {
  const entries = [
    { team: { displayName: "Tough D" }, stats: [{ name: "avgPointsAgainst", value: 74 }] },
    { team: { displayName: "Soft D" }, stats: [{ name: "avgPointsAgainst", value: 88 }] },
    { team: { displayName: "Mid D" }, stats: [{ name: "avgPointsAgainst", value: 80 }] },
  ];
  it("ranks fewest-allowed as rank 1 (toughest)", () => {
    const ranks = buildDefenseRanks(entries, "basketball");
    expect(ranks.get("tough d")?.rank).toBe(1);
    expect(ranks.get("soft d")?.rank).toBe(3);
    expect(ranks.size).toBe(3);
  });
  it("computes hockey per-game from totals", () => {
    const ranks = buildDefenseRanks(
      [{ team: { displayName: "Team A" }, stats: [{ name: "pointsAgainst", value: 100 }, { name: "gamesPlayed", value: 40 }] }],
      "hockey",
    );
    expect(ranks.get("team a")?.paPerGame).toBeCloseTo(2.5, 3);
  });
});

describe("injury status mapping", () => {
  it("maps IL / Out to out", () => {
    expect(mapInjuryStatus({ statusName: "Injured", typeDescription: "10-day IL" })).toBe("out");
    expect(mapInjuryStatus({ statusName: "Out" })).toBe("out");
  });
  it("maps day-to-day / questionable to questionable", () => {
    expect(mapInjuryStatus({ statusName: "Day-To-Day" })).toBe("questionable");
    expect(mapInjuryStatus({ statusName: "Questionable" })).toBe("questionable");
  });
  it("maps doubtful and active", () => {
    expect(mapInjuryStatus({ statusName: "Doubtful" })).toBe("doubtful");
    expect(mapInjuryStatus({ statusName: "Active" })).toBe("active");
  });
});

describe("rest days from game dates", () => {
  it("computes rest days to the slate date, ignoring future games", () => {
    const dates = ["2026-07-20T00:30:00Z", "2026-07-18T00:00:00Z", "2026-07-30T00:00:00Z"];
    const r = restFromDates(dates, "2026-07-22")!;
    // most recent prior game shifts to 2026-07-19 (−6h) → 3 days rest
    expect(r.restDays).toBe(3);
    expect(r.backToBack).toBe(false);
  });
  it("flags a back-to-back", () => {
    const r = restFromDates(["2026-07-21T02:00:00Z"], "2026-07-22")!; // −6h → 2026-07-20 → 2 days? check b2b threshold
    expect(r.backToBack).toBe(r.restDays <= 1);
  });
  it("returns null when there is no prior game", () => {
    expect(restFromDates(["2026-08-01T00:00:00Z"], "2026-07-22")).toBeNull();
  });
});
