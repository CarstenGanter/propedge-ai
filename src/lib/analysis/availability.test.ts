import { describe, expect, it } from "vitest";
import {
  creditsSavedPerSlate,
  marketsToDrop,
  summarizeAvailability,
  MIN_OBSERVATIONS,
  type AvailabilityInput,
} from "./availability";

const rows = (propType: string, offered: number, missing: number, unchecked = 0): AvailabilityInput[] => [
  ...Array.from({ length: offered }, () => ({ propType, available: true })),
  ...Array.from({ length: missing }, () => ({ propType, available: false })),
  ...Array.from({ length: unchecked }, () => ({ propType, available: null })),
];

describe("summarizeAvailability", () => {
  it("counts only what was actually checked", () => {
    // 36 props fetched, 3 looked at — the other 33 say nothing either way.
    const [m] = summarizeAvailability(rows("Passing Yards", 0, 3, 33));
    expect(m.checked).toBe(3);
    expect(m.missing).toBe(3);
    expect(m.offeredRate).toBe(0);
    expect(m.conclusive).toBe(false);
    expect(m.recommendDrop).toBe(false);
  });

  it("ignores a market nobody has checked at all", () => {
    expect(summarizeAvailability(rows("Rush Attempts", 0, 0, 12))).toEqual([]);
  });

  it("recommends dropping a market never once seen", () => {
    const [m] = summarizeAvailability(rows("Passing Yards", 0, MIN_OBSERVATIONS));
    expect(m.conclusive).toBe(true);
    expect(m.recommendDrop).toBe(true);
  });

  it("keeps a market that shows up even rarely", () => {
    // One sighting in nine is enough to keep paying for it.
    const [m] = summarizeAvailability(rows("Rush+Rec Yards", 1, 8));
    expect(m.conclusive).toBe(true);
    expect(m.recommendDrop).toBe(false);
    expect(m.offeredRate).toBeCloseTo(1 / 9, 6);
  });

  it("orders by how much evidence each market has", () => {
    const summary = summarizeAvailability([
      ...rows("Receptions", 10, 2),
      ...rows("Pass TDs", 1, 1),
      ...rows("Receiving Yards", 4, 1),
    ]);
    expect(summary.map((m) => m.propType)).toEqual(["Receptions", "Receiving Yards", "Pass TDs"]);
  });
});

describe("marketsToDrop", () => {
  it("names only the markets proven absent", () => {
    const all = [
      ...rows("Passing Yards", 0, 10),
      ...rows("Receptions", 9, 3),
      ...rows("Pass Attempts", 0, 2), // too few checks to act on
    ];
    expect(marketsToDrop(all)).toEqual(["Passing Yards"]);
  });

  it("returns nothing on an unexamined board", () => {
    expect(marketsToDrop(rows("Receiving Yards", 0, 0, 200))).toEqual([]);
  });
});

describe("creditsSavedPerSlate", () => {
  it("multiplies markets by games, matching Odds API per-event pricing", () => {
    expect(creditsSavedPerSlate(1, 13)).toBe(13);
    expect(creditsSavedPerSlate(2, 1)).toBe(2);
  });

  it("is zero when there is nothing to drop", () => {
    expect(creditsSavedPerSlate(0, 16)).toBe(0);
    expect(creditsSavedPerSlate(3, 0)).toBe(0);
  });
});
