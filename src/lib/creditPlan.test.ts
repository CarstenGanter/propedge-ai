import { describe, expect, it } from "vitest";
import { NOVEMBER_2026, planFor, planThrough, spendVsPlan } from "./creditPlan";

const at = (iso: string, credits: number | null) => ({ at: new Date(iso), credits });

describe("the November 2026 plan", () => {
  it("adds up to the approved 402", () => {
    expect(NOVEMBER_2026.slates.reduce((s, x) => s + x.credits, 0)).toBe(402);
    expect(planThrough(NOVEMBER_2026, "2026-11-01")).toBe(70);
    expect(planThrough(NOVEMBER_2026, "2026-11-15")).toBe(218);
    expect(planThrough(NOVEMBER_2026, "2026-11-30")).toBe(402);
  });

  it("is the plan for November slates only", () => {
    expect(planFor("2026-11-08")).toBe(NOVEMBER_2026);
    expect(planFor("2026-10-29")).toBeNull();
  });
});

describe("spendVsPlan", () => {
  it("compares spend through a slate with the plan through it, by Eastern slate date", () => {
    const spends = [
      at("2026-11-01T15:30:00Z", 48), // Sunday's fetch
      at("2026-11-02T00:10:00Z", 12), // Sunday night's closing lines (7:10 pm Eastern, still Sunday)
      at("2026-11-02T22:00:00Z", 4), // Monday's fetch — not in Sunday's numbers
    ];
    const r = spendVsPlan(NOVEMBER_2026, spends, "2026-11-01");
    expect(r).toMatchObject({ spent: 60, plan: 70, drift: -10, unknownCost: 0 });
  });

  it("leaves out spend from another month, and counts calls of unknown cost", () => {
    const spends = [
      at("2026-10-31T23:59:00Z", 13), // October's credits
      at("2026-11-01T15:30:00Z", null), // a timed-out call
      at("2026-12-01T00:15:00Z", 5), // Nov 30's closing lines: December's credits
    ];
    const r = spendVsPlan(NOVEMBER_2026, spends, "2026-11-30");
    expect(r).toMatchObject({ spent: 0, unknownCost: 1, plan: 402 });
  });
});
