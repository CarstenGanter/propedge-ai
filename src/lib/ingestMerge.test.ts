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
  it("updates what is still offered, creates what is new, withdraws only what nothing depends on", () => {
    const plan = planIngest(
      [
        { id: "a", key: "k1", hasPick: true, priced: true },
        { id: "b", key: "k2", hasPick: false, priced: true },
        { id: "c", key: "gone-picked", hasPick: true, priced: true },
        { id: "d", key: "gone-free", hasPick: false, priced: true },
      ],
      ["k1", "k2", "k3"],
    );
    expect([...plan.update]).toEqual([
      ["k1", { id: "a", hasPick: true }],
      ["k2", { id: "b", hasPick: false }],
    ]);
    expect(plan.create).toEqual(["k3"]);
    // A prop with a pick is never withdrawn, even when the books pulled it.
    expect(plan.withdraw).toEqual(["d"]);
  });

  it("leaves a game this fetch didn't price alone: started after kickoff, timed out, or past the event cap", () => {
    // Sunday 1:30pm re-fetch: the 1pm game has started, so the books' feed no longer lists it.
    const plan = planIngest(
      [
        { id: "early-game", key: "1pm|receiver", hasPick: false, priced: false },
        { id: "late-game", key: "4pm|receiver", hasPick: false, priced: true },
      ],
      ["4pm|receiver"],
    );
    expect(plan.withdraw).toEqual([]);
    expect(plan.update.get("4pm|receiver")).toEqual({ id: "late-game", hasPick: false });
  });

  it("keeps the row with a pick when duplicates exist, and withdraws the spare", () => {
    const plan = planIngest(
      [
        { id: "spare", key: "k", hasPick: false, priced: true },
        { id: "real", key: "k", hasPick: true, priced: true },
      ],
      ["k"],
    );
    expect(plan.update.get("k")).toEqual({ id: "real", hasPick: true });
    expect(plan.withdraw).toEqual(["spare"]);
  });

  it("revives a withdrawn prop the books offer again, in preference to a spare", () => {
    const plan = planIngest(
      [
        { id: "old", key: "k", hasPick: false, priced: true, withdrawn: true },
      ],
      ["k"],
    );
    expect(plan.update.get("k")).toEqual({ id: "old", hasPick: false });
    expect(plan.create).toEqual([]);
    expect(plan.withdraw).toEqual([]);
  });

  it("does not withdraw twice", () => {
    const plan = planIngest([{ id: "w", key: "k", hasPick: false, priced: true, withdrawn: true }], []);
    expect(plan.withdraw).toEqual([]);
  });

  it("does nothing destructive on an empty fetch", () => {
    const plan = planIngest([{ id: "a", key: "k", hasPick: true, priced: false }], []);
    expect(plan.withdraw).toEqual([]);
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
