import { describe, expect, it } from "vitest";
import {
  isPassOrRecProp,
  nflSeasonForDate,
  pickSlateDate,
  positionsBoostingProp,
  statFamilyForProp,
  toNflSlateDate,
} from "./slate";

describe("toNflSlateDate", () => {
  it("maps kickoffs to the US Eastern calendar day", () => {
    expect(toNflSlateDate("2026-09-13T17:00:00Z")).toBe("2026-09-13"); // 1pm ET
    expect(toNflSlateDate("2026-09-14T00:20:00Z")).toBe("2026-09-13"); // SNF 8:20pm ET
    expect(toNflSlateDate("2026-09-15T00:15:00Z")).toBe("2026-09-14"); // MNF
  });
  it("handles standard time (after DST ends)", () => {
    expect(toNflSlateDate("2026-12-14T01:20:00Z")).toBe("2026-12-13"); // SNF 8:20pm EST
  });
  it("returns empty for garbage", () => {
    expect(toNflSlateDate("nope")).toBe("");
  });
});

describe("pickSlateDate", () => {
  const kicks = ["2026-09-11T00:20:00Z", "2026-09-13T17:00:00Z", "2026-09-15T00:15:00Z"];
  it("returns today when games kick off today", () => {
    expect(pickSlateDate(kicks, "2026-09-13")).toBe("2026-09-13");
  });
  it("returns the next game day otherwise", () => {
    expect(pickSlateDate(kicks, "2026-09-12")).toBe("2026-09-13");
    expect(pickSlateDate(kicks, "2026-09-09")).toBe("2026-09-10");
  });
  it("returns null when nothing is upcoming", () => {
    expect(pickSlateDate(kicks, "2026-09-20")).toBeNull();
  });
});

describe("nflSeasonForDate", () => {
  it("assigns Aug–Dec to that year's season and Jan–Feb to the prior year's", () => {
    expect(nflSeasonForDate("2026-09-13")).toEqual({ season: 2026, prior: 2025 });
    expect(nflSeasonForDate("2027-01-10")).toEqual({ season: 2026, prior: 2025 });
  });
});

describe("statFamilyForProp / isPassOrRecProp", () => {
  it("measures receiving yards against pass yards allowed, receptions against completions allowed", () => {
    expect(statFamilyForProp("Passing Yards")).toBe("passYds");
    expect(statFamilyForProp("Receiving Yards")).toBe("passYds");
    expect(statFamilyForProp("Completions")).toBe("completions");
    expect(statFamilyForProp("Receptions")).toBe("completions");
    expect(statFamilyForProp("Rushing Yards")).toBe("rush");
    expect(statFamilyForProp("Pass TDs")).toBe("passTd");
    expect(statFamilyForProp("Rush+Rec Yards")).toBe("total");
    expect(statFamilyForProp("Points")).toBeNull();
  });
  it("flags only passing-game props as weather-sensitive", () => {
    expect(isPassOrRecProp("Passing Yards")).toBe(true);
    expect(isPassOrRecProp("Receptions")).toBe(true);
    expect(isPassOrRecProp("Rushing Yards")).toBe(false);
    expect(isPassOrRecProp("Rush+Rec Yards")).toBe(false);
  });
  it("names the positions whose absence boosts each prop, never for a QB", () => {
    expect(positionsBoostingProp("Rushing Yards")).toEqual(["RB", "FB"]);
    expect(positionsBoostingProp("Receptions")).toEqual(["WR", "TE"]);
    expect(positionsBoostingProp("Rush+Rec Yards")).toEqual(["RB", "WR", "TE"]);
    expect(positionsBoostingProp("Passing Yards")).toEqual([]);
  });
});
