import { describe, expect, it } from "vitest";
import { planIngest, propKey, refreshableFields } from "./ingestMerge";

const id = (over: Partial<Parameters<typeof propKey>[0]> = {}) =>
  propKey({ date: "2026-10-01", playerName: "Amon-Ra St. Brown", propType: "Receptions", gameId: "401", team: "Lions", opponent: "Bears", ...over });

describe("propKey", () => {
  it("ignores spelling noise in the player's name", () => {
    expect(id({ playerName: "Amon-Ra St Brown" })).toBe(id());
    expect(id({ playerName: "AMON-RA ST. BROWN" })).toBe(id());
  });
  it("separates prop types, games and dates", () => {
    expect(id({ propType: "Receiving Yards" })).not.toBe(id());
    expect(id({ gameId: "402" })).not.toBe(id());
    expect(id({ date: "2026-10-04" })).not.toBe(id());
  });
  it("falls back to the matchup when no game id is known", () => {
    expect(id({ gameId: null })).toBe(id({ gameId: null, team: "lions" }));
  });
});

describe("planIngest", () => {
  it("updates what is still offered, creates what is new, removes only what nothing depends on", () => {
    const plan = planIngest(
      [
        { id: "a", key: "k1", hasPick: true },
        { id: "b", key: "k2", hasPick: false },
        { id: "c", key: "gone-picked", hasPick: true },
        { id: "d", key: "gone-free", hasPick: false },
      ],
      ["k1", "k2", "k3"],
    );
    expect([...plan.update]).toEqual([
      ["k1", { id: "a", hasPick: true }],
      ["k2", { id: "b", hasPick: false }],
    ]);
    expect(plan.create).toEqual(["k3"]);
    // A prop with a pick is never removed, even when the books pulled it.
    expect(plan.remove).toEqual(["d"]);
  });

  it("keeps the row with a pick when duplicates exist, and drops the spare", () => {
    const plan = planIngest(
      [
        { id: "spare", key: "k", hasPick: false },
        { id: "real", key: "k", hasPick: true },
      ],
      ["k"],
    );
    expect(plan.update.get("k")).toEqual({ id: "real", hasPick: true });
    expect(plan.remove).toEqual(["spare"]);
  });

  it("does nothing destructive on an empty fetch", () => {
    const plan = planIngest([{ id: "a", key: "k", hasPick: true }], []);
    expect(plan.remove).toEqual([]);
  });
});

describe("refreshableFields", () => {
  const incoming = { line: 55.5, direction: "UNDER", marketDataJson: "{new}", projection: 51 };
  it("refreshes everything on a prop nobody picked", () => {
    expect(refreshableFields(incoming, false)).toEqual(incoming);
  });
  it("keeps the line and side of a picked prop, refreshing only the market", () => {
    expect(refreshableFields(incoming, true)).toEqual({ marketDataJson: "{new}", projection: 51 });
  });
});
