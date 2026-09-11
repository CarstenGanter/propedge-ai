import { describe, expect, it } from "vitest";
import { appearsInBoxScore, extractFootballBoxStat, nameMatches, nameParts, type EspnStatGroup } from "./espn";

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

  it("returns null only when the player appears nowhere in the box score", () => {
    // Never listed at all → may have been inactive, so we refuse to guess.
    expect(extractFootballBoxStat(groups, "Chris Godwin", "Receiving Yards")).toBeNull();
  });

  it("scores a real zero when the player played but recorded nothing in that group", () => {
    // Bucky Irving rushed and caught passes but threw nothing.
    expect(extractFootballBoxStat(groups, "Bucky Irving", "Passing Yards")).toBe(0);
    // A back who played but had no catches is 0 receptions, not unknown.
    const rushOnly: EspnStatGroup[] = [
      {
        name: "rushing",
        keys: ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns", "longRushing"],
        athletes: [{ athlete: { displayName: "Blake Corum" }, stats: ["10", "54", "5.4", "0", "13"] }],
      },
      { name: "receiving", keys: ["receptions", "receivingYards"], athletes: [] },
    ];
    expect(extractFootballBoxStat(rushOnly, "Blake Corum", "Receptions")).toBe(0);
    expect(extractFootballBoxStat(rushOnly, "Blake Corum", "Receiving Yards")).toBe(0);
    expect(extractFootballBoxStat(rushOnly, "Blake Corum", "Rush+Rec Yards")).toBe(54);
    expect(extractFootballBoxStat(rushOnly, "Someone Else", "Receptions")).toBeNull();
  });

  it("returns null for an unsupported prop type", () => {
    expect(extractFootballBoxStat(groups, "Baker Mayfield", "Anytime TD")).toBeNull();
  });

  it("detects box-score participation", () => {
    expect(appearsInBoxScore(groups, "Bucky Irving")).toBe(true);
    expect(appearsInBoxScore(groups, "Chris Godwin")).toBe(false);
  });
});

describe("name matching with generational suffixes", () => {
  it("strips Jr/Sr/II/III/IV so book names match ESPN names", () => {
    expect(nameParts("Deebo Samuel Sr.")).toEqual(["deebo", "samuel"]);
    expect(nameParts("Michael Pittman Jr.")).toEqual(["michael", "pittman"]);
    expect(nameParts("Kenneth Walker III")).toEqual(["kenneth", "walker"]);
    expect(nameMatches("Deebo Samuel Sr.", "Deebo Samuel")).toBe(true);
    expect(nameMatches("Michael Pittman Jr.", "Michael Pittman")).toBe(true);
    expect(nameMatches("Brian Thomas Jr.", "Brian Thomas Jr.")).toBe(true);
    expect(nameMatches("Travis Etienne Jr.", "Travis Etienne")).toBe(true);
  });

  it("still matches on last name plus first initial, and accents", () => {
    expect(nameMatches("B. Mayfield", "Baker Mayfield")).toBe(true);
    expect(nameMatches("José Alvarado", "Jose Alvarado")).toBe(true);
  });

  it("does not match different people", () => {
    expect(nameMatches("Deebo Samuel", "Curtis Samuel")).toBe(false);
    expect(nameMatches("Kyren Williams", "Jameson Williams")).toBe(false);
    expect(nameMatches("", "Deebo Samuel")).toBe(false);
  });

  it("does not strip a lone name that is only a suffix", () => {
    expect(nameParts("Jr")).toEqual(["jr"]);
  });
});
