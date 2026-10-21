import { describe, expect, it } from "vitest";
import { diffInjuryReports, isNewsworthyOut, missingFromReport, parseInjuryReport, teammateAbsenceBoost, type NflTeamInjuryReport } from "./injuryReport";

// Verified ESPN summary `injuries` shape.
const summary = {
  injuries: [
    {
      team: { displayName: "Cincinnati Bengals" },
      injuries: [
        { status: "Injured Reserve", athlete: { displayName: "Brian Parker II", position: { abbreviation: "OT" } }, details: { type: "Undisclosed" }, date: "2026-09-08T20:42Z" },
        { status: "Questionable", athlete: { displayName: "Tee Higgins", position: { abbreviation: "WR" } }, details: { type: "Heel" }, date: "2026-09-08T20:42Z" },
        { status: "Out", athlete: { displayName: "Chase Brown", position: { abbreviation: "RB" } }, details: { type: "Knee" }, longComment: "Ruled out Friday." },
        { status: "Doubtful", athlete: { displayName: "Mike Gesicki", position: { abbreviation: "TE" } }, details: { type: "Hamstring" } },
      ],
    },
  ],
};

describe("parseInjuryReport", () => {
  const report = parseInjuryReport(summary);

  it("maps ESPN status words to our enum and keeps the raw text", () => {
    const byName = Object.fromEntries(report[0].players.map((p) => [p.name, p]));
    expect(byName["Brian Parker II"].status).toBe("out");
    expect(byName["Brian Parker II"].rawStatus).toBe("Injured Reserve");
    expect(byName["Tee Higgins"].status).toBe("questionable");
    expect(byName["Tee Higgins"].detail).toBe("Heel");
    expect(byName["Chase Brown"].status).toBe("out");
    expect(byName["Chase Brown"].comment).toBe("Ruled out Friday.");
    expect(byName["Mike Gesicki"].status).toBe("doubtful");
  });

  it("returns an empty list when nothing was published", () => {
    expect(parseInjuryReport({})).toEqual([]);
  });
});

describe("teammateAbsenceBoost", () => {
  const report: NflTeamInjuryReport = parseInjuryReport(summary)[0];

  it("boosts a rushing prop when another RB is out", () => {
    const r = teammateAbsenceBoost("Rushing Yards", "Samaje Perine", report);
    expect(r.boost).toBe(true);
    expect(r.names).toEqual(["Chase Brown (RB, Out)"]);
  });

  it("boosts a receiving prop when a WR/TE is out or doubtful, ignoring questionable", () => {
    const r = teammateAbsenceBoost("Receptions", "Ja'Marr Chase", report);
    expect(r.boost).toBe(true);
    expect(r.names).toEqual(["Mike Gesicki (TE, Doubtful)"]); // Higgins is only questionable
  });

  it("never counts the player himself", () => {
    expect(teammateAbsenceBoost("Rushing Yards", "Chase Brown", report).boost).toBe(false);
  });

  it("gives passing props no boost", () => {
    expect(teammateAbsenceBoost("Passing Yards", "Joe Burrow", report).boost).toBe(false);
  });

  it("handles a missing report", () => {
    expect(teammateAbsenceBoost("Receptions", "Anyone", undefined)).toEqual({ boost: false, names: [] });
  });
});

describe("diffInjuryReports", () => {
  const report = (players: { name: string; status: "out" | "questionable" | "doubtful" | "active" }[]) => [
    { team: "Seattle Seahawks", players: players.map((p) => ({ name: p.name, position: "WR", status: p.status, rawStatus: p.status, detail: null, date: null, comment: null })) },
  ];

  it("records a first sighting and a status change", () => {
    const prev = new Map([["Seattle Seahawks|Cooper Kupp", "questionable"]]);
    const changes = diffInjuryReports(prev, report([{ name: "Cooper Kupp", status: "out" }, { name: "Tory Horton", status: "questionable" }]));
    expect(changes).toEqual([
      { team: "Seattle Seahawks", playerName: "Cooper Kupp", position: "WR", fromStatus: "questionable", toStatus: "out", rawStatus: "out" },
      { team: "Seattle Seahawks", playerName: "Tory Horton", position: "WR", fromStatus: null, toStatus: "questionable", rawStatus: "questionable" },
    ]);
  });

  it("records nothing when nothing changed", () => {
    expect(diffInjuryReports(new Map([["Seattle Seahawks|Cooper Kupp", "out"]]), report([{ name: "Cooper Kupp", status: "out" }]))).toEqual([]);
  });

  it("clears a player only after two checks in a row without him, and only once", () => {
    const prev = new Map([["Seattle Seahawks|Cooper Kupp", "questionable"]]);
    // First miss: no change, but remembered.
    expect(diffInjuryReports(prev, report([]))).toEqual([]);
    const missing = missingFromReport(prev, report([]));
    expect([...missing]).toEqual(["Seattle Seahawks|Cooper Kupp"]);
    // Second miss in a row: cleared.
    expect(diffInjuryReports(prev, report([]), missing)).toMatchObject([{ playerName: "Cooper Kupp", fromStatus: "questionable", toStatus: "cleared" }]);
    expect(diffInjuryReports(new Map([["Seattle Seahawks|Cooper Kupp", "cleared"]]), report([]), missing)).toEqual([]);
  });

  it("ignores a one-fetch flap — the A.J. Brown pattern", () => {
    const prev = new Map([["Seattle Seahawks|Cooper Kupp", "questionable"]]);
    const missing = missingFromReport(prev, report([])); // dropped off once
    // Back on the next fetch with the same status: nothing happened.
    expect(diffInjuryReports(prev, report([{ name: "Cooper Kupp", status: "questionable" }]), missing)).toEqual([]);
    expect(missingFromReport(prev, report([{ name: "Cooper Kupp", status: "questionable" }])).size).toBe(0);
  });
});

describe("isNewsworthyOut", () => {
  it("counts a change to Out from a real earlier status, not a first sighting or a reappearance", () => {
    expect(isNewsworthyOut({ fromStatus: "questionable", toStatus: "out" })).toBe(true);
    expect(isNewsworthyOut({ fromStatus: "doubtful", toStatus: "out" })).toBe(true);
    expect(isNewsworthyOut({ fromStatus: null, toStatus: "out" })).toBe(false);
    expect(isNewsworthyOut({ fromStatus: "cleared", toStatus: "out" })).toBe(false);
    expect(isNewsworthyOut({ fromStatus: "questionable", toStatus: "doubtful" })).toBe(false);
  });
});
