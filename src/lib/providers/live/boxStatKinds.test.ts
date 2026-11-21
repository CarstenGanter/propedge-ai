import { describe, expect, it } from "vitest";
import { basketballBoxStat, footballBoxStat, type EspnStatGroup } from "./espn";
import { lookupFromBoxStat } from "../resultsProvider";

const receiving = (athletes: { name: string; stats: string[] }[], keys = ["receptions", "receivingYards"]): EspnStatGroup => ({
  name: "receiving",
  keys,
  athletes: athletes.map((a) => ({ athlete: { displayName: a.name }, stats: a.stats })),
});
const rushing: EspnStatGroup = { name: "rushing", keys: ["rushingAttempts", "rushingYards"], athletes: [{ athlete: { displayName: "Bucky Irving" }, stats: ["12", "48"] }] };

describe("footballBoxStat", () => {
  it("tells apart a stat, a played-but-absent-from-group zero, and a player listed nowhere", () => {
    const groups = [rushing, receiving([{ name: "Emeka Egbuka", stats: ["4", "67"] }])];
    expect(footballBoxStat(groups, "Emeka Egbuka", "Receiving Yards")).toEqual({ kind: "stat", value: 67 });
    expect(footballBoxStat(groups, "Bucky Irving", "Receiving Yards")).toEqual({ kind: "stat", value: 0 });
    expect(footballBoxStat(groups, "Lil'Jordan Humphrey", "Receiving Yards")).toEqual({ kind: "absent" });
  });

  it("says ambiguous when two players match the name, instead of 'absent'", () => {
    const groups = [receiving([{ name: "Jameson Williams", stats: ["3", "40"] }, { name: "Javonte Williams", stats: ["2", "11"] }])];
    expect(footballBoxStat(groups, "J. Williams", "Receiving Yards")).toEqual({ kind: "ambiguous" });
  });

  it("never adds a namesake from the other team's group — Trevor Etienne, 2026-11-15", () => {
    // Each team has its own rushing group. Trevor (CAR) ran for 1; Travis Etienne Jr. (NO) for 14.
    const rush = (name: string, yds: string): EspnStatGroup => ({ name: "rushing", keys: ["rushingAttempts", "rushingYards"], athletes: [{ athlete: { displayName: name }, stats: ["3", yds] }] });
    const groups = [rush("Travis Etienne Jr.", "14"), rush("Trevor Etienne", "1")];
    expect(footballBoxStat(groups, "Trevor Etienne", "Rushing Yards")).toEqual({ kind: "stat", value: 1 });
    expect(footballBoxStat(groups, "Travis Etienne Jr.", "Rushing Yards")).toEqual({ kind: "stat", value: 14 });
    // A bare surname-and-initial name that fits both is ambiguous, never a sum.
    expect(footballBoxStat(groups, "T. Etienne", "Rushing Yards")).toEqual({ kind: "ambiguous" });
  });

  it("still takes a lone fuzzy match, e.g. a suffix the feed dropped", () => {
    const groups = [{ name: "rushing", keys: ["rushingAttempts", "rushingYards"], athletes: [{ athlete: { displayName: "Travis Etienne Jr." }, stats: ["8", "14"] }] }];
    expect(footballBoxStat(groups, "Travis Etienne", "Rushing Yards")).toEqual({ kind: "stat", value: 14 });
  });

  it("says unreadable when the player is there but the stat isn't", () => {
    expect(footballBoxStat([receiving([{ name: "Emeka Egbuka", stats: ["4", "67"] }], ["receptions", "recYds"])], "Emeka Egbuka", "Receiving Yards")).toMatchObject({ kind: "unreadable" });
    expect(footballBoxStat([receiving([{ name: "Emeka Egbuka", stats: ["4", "--"] }])], "Emeka Egbuka", "Receiving Yards")).toMatchObject({ kind: "unreadable" });
  });
});

describe("basketballBoxStat", () => {
  const keys = ["minutes", "points", "rebounds", "assists"];
  const group = (stats: string[]): EspnStatGroup => ({ keys, athletes: [{ athlete: { displayName: "Napheesa Collier" }, stats }] });
  it("reads a DNP row (no stats, or all placeholders) as absent", () => {
    expect(basketballBoxStat([group([])], "Napheesa Collier", "Points")).toEqual({ kind: "absent" });
    expect(basketballBoxStat([group(["--", "--", "--", "--"])], "Napheesa Collier", "Points")).toEqual({ kind: "absent" });
    expect(basketballBoxStat([group(["25", "15", "6", "3"])], "Napheesa Collier", "Pts+Reb+Ast")).toEqual({ kind: "stat", value: 24 });
  });
});

describe("lookupFromBoxStat", () => {
  it("flags only a player listed nowhere as absent — the only case the snap fallback may settle", () => {
    expect(lookupFromBoxStat({ kind: "absent" })).toMatchObject({ resolved: false, absentFromBoxScore: true });
    for (const b of [{ kind: "ambiguous" }, { kind: "unreadable", reason: "x" }, { kind: "unavailable", reason: "the ESPN box score couldn't be fetched" }] as const) {
      const r = lookupFromBoxStat(b);
      expect(r.resolved).toBe(false);
      expect(r.absentFromBoxScore).toBeUndefined();
    }
    expect(lookupFromBoxStat({ kind: "unavailable", reason: "the ESPN box score couldn't be fetched" }).note).toBe("The ESPN box score couldn't be fetched — retried later, or settle manually.");
    expect(lookupFromBoxStat({ kind: "stat", value: 0 })).toEqual({ actualResult: 0, source: "ESPN box score", resolved: true });
  });
});
