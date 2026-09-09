import { describe, expect, it } from "vitest";
import { extractFootballBoxStat, type EspnStatGroup } from "./espn";

// Verified NFL box-score shape (group name + machine keys + parallel stats).
const groups: EspnStatGroup[] = [
  {
    name: "passing",
    keys: ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt", "passingTouchdowns", "interceptions", "sacks-sackYardsLost", "adjQBR", "QBRating"],
    labels: ["C/ATT", "YDS", "AVG", "TD", "INT", "SACKS", "QBR", "RTG"],
    athletes: [{ athlete: { displayName: "Baker Mayfield" }, stats: ["17/32", "167", "5.2", "3", "0", "1-8", "88.3", "99.3"] }],
  },
  {
    name: "rushing",
    keys: ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns", "longRushing"],
    labels: ["CAR", "YDS", "AVG", "TD", "LONG"],
    athletes: [
      { athlete: { displayName: "Baker Mayfield" }, stats: ["5", "39", "7.8", "0", "20"] },
      { athlete: { displayName: "Bucky Irving" }, stats: ["14", "62", "4.4", "1", "18"] },
    ],
  },
  {
    name: "receiving",
    keys: ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns", "longReception", "receivingTargets"],
    labels: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"],
    athletes: [
      { athlete: { displayName: "Emeka Egbuka" }, stats: ["4", "67", "16.8", "2", "30", "6"] },
      { athlete: { displayName: "Bucky Irving" }, stats: ["3", "21", "7.0", "0", "11", "4"] },
    ],
  },
  {
    name: "fumbles",
    keys: ["fumbles", "fumblesLost", "fumblesRecovered"],
    labels: ["FUM", "LOST", "REC"],
    athletes: [{ athlete: { displayName: "Emeka Egbuka" }, stats: ["1", "0", "1"] }],
  },
];

describe("extractFootballBoxStat", () => {
  it("reads QB passing stats from the passing group, not the rushing 'YDS' column", () => {
    expect(extractFootballBoxStat(groups, "Baker Mayfield", "Passing Yards")).toBe(167);
    expect(extractFootballBoxStat(groups, "Baker Mayfield", "Pass TDs")).toBe(3);
    expect(extractFootballBoxStat(groups, "Baker Mayfield", "Completions")).toBe(17);
    expect(extractFootballBoxStat(groups, "Baker Mayfield", "Pass Attempts")).toBe(32);
  });

  it("reads rushing and receiving stats from their own groups", () => {
    expect(extractFootballBoxStat(groups, "Baker Mayfield", "Rushing Yards")).toBe(39);
    expect(extractFootballBoxStat(groups, "Bucky Irving", "Rush Attempts")).toBe(14);
    expect(extractFootballBoxStat(groups, "Emeka Egbuka", "Receiving Yards")).toBe(67);
    expect(extractFootballBoxStat(groups, "Emeka Egbuka", "Receptions")).toBe(4);
  });

  it("does not confuse the fumbles 'REC' label with receptions", () => {
    // Egbuka has 1 fumble recovery but 4 receptions.
    expect(extractFootballBoxStat(groups, "Emeka Egbuka", "Receptions")).toBe(4);
  });

  it("sums rushing + receiving yards, treating a missing side as 0", () => {
    expect(extractFootballBoxStat(groups, "Bucky Irving", "Rush+Rec Yards")).toBe(83);
    expect(extractFootballBoxStat(groups, "Emeka Egbuka", "Rush+Rec Yards")).toBe(67); // no rushing line
  });

  it("matches on last name + first initial", () => {
    expect(extractFootballBoxStat(groups, "B. Mayfield", "Passing Yards")).toBe(167);
  });

  it("returns null when the player is absent from every relevant group (DNP)", () => {
    expect(extractFootballBoxStat(groups, "Chris Godwin", "Receiving Yards")).toBeNull();
    expect(extractFootballBoxStat(groups, "Emeka Egbuka", "Passing Yards")).toBeNull();
  });

  it("returns null for an unsupported prop type", () => {
    expect(extractFootballBoxStat(groups, "Baker Mayfield", "Anytime TD")).toBeNull();
  });
});
