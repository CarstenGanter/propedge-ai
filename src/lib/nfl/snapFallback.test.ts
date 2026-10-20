import { describe, expect, it } from "vitest";
import { snapFallbackDecision } from "./snapFallback";
import type { RosterEntry, SeasonData, StatRow } from "./gradeProps";

// Week 6, DEN (home) vs SEA: one stat line posted for the game, so nflverse has it.
const statRow = (gsisId: string, name: string, receivingYards = 40): StatRow => ({
  gsisId, name, week: 6, team: "DEN", opponent: "SEA",
  receptions: 3, receivingYards, rushingYards: 0, carries: 0, passingYards: 0, passingTds: 0, completions: 0, attempts: 0,
});
const rostered = (gsisId: string, espnId: string, name: string, status = "ACT"): RosterEntry => ({ gsisId, espnId, week: 6, team: "DEN", status, name });
const season = (over: Partial<SeasonData> = {}): SeasonData => ({
  rows: [statRow("00-sutton", "Courtland Sutton")],
  appearances: [{ gsisId: "00-sutton", name: "Courtland Sutton", week: 6, team: "DEN" }],
  specialTeamsOnly: [],
  roster: [rostered("00-sutton", "1", "Courtland Sutton"), rostered("00-humphrey", "2", "Lil'Jordan Humphrey")],
  ...over,
});
const prop = { playerName: "Lil'Jordan Humphrey", espnId: "2", propType: "Receiving Yards", home: "DEN", away: "SEA" };

describe("snapFallbackDecision", () => {
  it("offensive snaps and no stat line: settles at 0", () => {
    const s = season({ appearances: [...season().appearances, { gsisId: "00-humphrey", name: "Lil'Jordan Humphrey", week: 6, team: "DEN" }] });
    expect(snapFallbackDecision(prop, s)).toMatchObject({ kind: "settle", actualResult: 0 });
  });

  it("special teams only: void", () => {
    const s = season({ specialTeamsOnly: [{ gsisId: "00-humphrey", name: "Lil'Jordan Humphrey", week: 6, team: "DEN" }] });
    expect(snapFallbackDecision(prop, s)).toMatchObject({ kind: "void" });
    expect((snapFallbackDecision(prop, s) as { note: string }).note).toContain("special teams only");
  });

  it("no snaps at all: void", () => {
    const s = season({ roster: [rostered("00-sutton", "1", "Courtland Sutton"), rostered("00-humphrey", "2", "Lil'Jordan Humphrey", "INA")] });
    const d = snapFallbackDecision(prop, s);
    expect(d).toMatchObject({ kind: "void" });
    expect((d as { note: string }).note).toContain("did not play (roster status INA)");
  });

  it("waits while nflverse hasn't posted the game, or that week's snap counts", () => {
    expect(snapFallbackDecision(prop, season({ rows: [] }))).toMatchObject({ kind: "wait" });
    // Stats posted, snaps not: a missing snap row must not read as "did not play".
    expect(snapFallbackDecision(prop, season({ appearances: [] }))).toMatchObject({ kind: "wait" });
  });

  it("leaves it for the Results page when nflverse has a stat line ESPN lacked, or can't find the player", () => {
    const s = season({ rows: [...season().rows, statRow("00-humphrey", "Lil'Jordan Humphrey", 22)] });
    expect(snapFallbackDecision(prop, s)).toMatchObject({ kind: "manual" });
    expect(snapFallbackDecision({ ...prop, espnId: null, playerName: "Nobody Here" }, season())).toMatchObject({ kind: "manual" });
  });
});
