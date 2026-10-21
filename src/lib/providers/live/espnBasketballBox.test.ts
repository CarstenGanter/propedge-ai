import { describe, expect, it } from "vitest";
import { espnGradesProp, extractBasketballBoxStat, type EspnStatGroup } from "./espn";

// ESPN WNBA event 401857093 (2026-07-28, Lynx 100, Tempo 93), Lynx group as served.
const KEYS = [
  "minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "freeThrowsMade-freeThrowsAttempted", "rebounds", "assists", "turnovers", "steals", "blocks",
  "offensiveRebounds", "defensiveRebounds", "fouls", "plusMinus",
];
const LABELS = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"];
const lynx: EspnStatGroup = {
  labels: LABELS,
  names: LABELS,
  keys: KEYS,
  athletes: [
    { athlete: { displayName: "Napheesa Collier" }, stats: ["25", "15", "6-13", "0-3", "3-4", "6", "3", "2", "2", "1", "1", "5", "4", "+7"] },
    { athlete: { displayName: "Bench Player" }, stats: [] }, // dressed, did not play
  ],
};

describe("extractBasketballBoxStat", () => {
  it("sums a combo prop from its columns — Collier's Pts+Reb+Ast was 15 + 6 + 3", () => {
    expect(extractBasketballBoxStat([lynx], "Napheesa Collier", "Pts+Reb+Ast")).toBe(24);
    expect(extractBasketballBoxStat([lynx], "Napheesa Collier", "Steals+Blocks")).toBe(3);
  });

  it("reads single stats, and made threes from the made-attempted column", () => {
    expect(extractBasketballBoxStat([lynx], "Napheesa Collier", "Points")).toBe(15);
    expect(extractBasketballBoxStat([lynx], "Napheesa Collier", "3-Pointers Made")).toBe(0);
  });

  it("reads rebounds by key, never the offensive-rebounds column, whatever the column order", () => {
    const order = [10, 1, 2, 3, 4, 11, 6, 7, 8, 9, 5, 0, 12, 13]; // OREB before REB
    const shuffled: EspnStatGroup = {
      keys: order.map((i) => KEYS[i]),
      labels: order.map((i) => LABELS[i]),
      athletes: [{ athlete: { displayName: "Napheesa Collier" }, stats: order.map((i) => lynx.athletes![0].stats![i]) }],
    };
    expect(extractBasketballBoxStat([shuffled], "Napheesa Collier", "Rebounds")).toBe(6);
  });

  it("treats a '--' cell as unknown, not 0 — a DNP listed with placeholders", () => {
    const dnp: EspnStatGroup = { ...lynx, athletes: [{ athlete: { displayName: "Bench Player" }, stats: KEYS.map(() => "--") }] };
    expect(extractBasketballBoxStat([dnp], "Bench Player", "Points")).toBeNull();
    expect(extractBasketballBoxStat([dnp], "Bench Player", "Pts+Reb+Ast")).toBeNull();
  });

  it("returns null for a player who dressed but did not play, or isn't listed", () => {
    expect(extractBasketballBoxStat([lynx], "Bench Player", "Points")).toBeNull();
    expect(extractBasketballBoxStat([lynx], "Someone Else", "Points")).toBeNull();
  });
});

describe("espnGradesProp", () => {
  it("knows which prop types settlement can grade, so a null isn't mistaken for an absent player", () => {
    expect(espnGradesProp("WNBA", "Pts+Reb+Ast")).toBe(true);
    expect(espnGradesProp("NBA", "Steals+Blocks")).toBe(true);
    expect(espnGradesProp("NFL", "Rush+Rec Yards")).toBe(true);
    expect(espnGradesProp("NHL", "Blocked Shots")).toBe(false);
    expect(espnGradesProp("Cricket", "Runs")).toBe(false);
  });
});
