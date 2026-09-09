import { describe, expect, it } from "vitest";
import { estimateCredits, filterEventsForSlate, marketKeysForPropTypes, noVigProbOver } from "./theOddsApi";
import { toNflSlateDate } from "@/lib/nfl/slate";

describe("filterEventsForSlate", () => {
  const events = [
    { id: "tnf", commence_time: "2026-09-11T00:20:00Z" }, // Thu 8:20pm ET
    { id: "sun-early", commence_time: "2026-09-13T17:00:00Z" }, // Sun 1pm ET
    { id: "snf", commence_time: "2026-09-14T00:20:00Z" }, // Sun 8:20pm ET (Monday in UTC)
    { id: "mnf", commence_time: "2026-09-15T00:15:00Z" }, // Mon 8:15pm ET
  ];

  it("keeps only the slate's games using the Eastern-time mapper (SNF stays on Sunday)", () => {
    const sunday = filterEventsForSlate(events, "2026-09-13", toNflSlateDate).map((e) => e.id);
    expect(sunday).toEqual(["sun-early", "snf"]);
  });

  it("excludes Thursday and Monday games from the Sunday slate", () => {
    const ids = filterEventsForSlate(events, "2026-09-13", toNflSlateDate).map((e) => e.id);
    expect(ids).not.toContain("tnf");
    expect(ids).not.toContain("mnf");
  });

  it("returns nothing for a date with no games", () => {
    expect(filterEventsForSlate(events, "2026-09-12", toNflSlateDate)).toEqual([]);
  });
});

describe("estimateCredits", () => {
  it("charges one credit per market per region per game", () => {
    expect(estimateCredits(14, 6)).toBe(84);
    expect(estimateCredits(13, 6, 1)).toBe(78);
    expect(estimateCredits(2, 3, 2)).toBe(12);
  });
  it("never goes negative", () => {
    expect(estimateCredits(0, 6)).toBe(0);
    expect(estimateCredits(-1, 6)).toBe(0);
  });
});

describe("marketKeysForPropTypes", () => {
  it("maps NFL prop labels to Odds API market keys and drops unknown labels", () => {
    expect(marketKeysForPropTypes("NFL", ["Passing Yards", "Rush+Rec Yards", "Anytime TD", "Receptions"])).toEqual([
      "player_pass_yds",
      "player_rush_reception_yds",
      "player_receptions",
    ]);
  });
  it("dedupes repeated labels", () => {
    expect(marketKeysForPropTypes("NFL", ["Receptions", "Receptions"])).toEqual(["player_receptions"]);
  });
});

describe("noVigProbOver", () => {
  it("removes the vig symmetrically", () => {
    expect(noVigProbOver(-110, -110)).toBeCloseTo(0.5, 5);
  });
});
