import { describe, expect, it } from "vitest";
import { parseInjuryReport, teammateAbsenceBoost, type NflTeamInjuryReport } from "./injuryReport";

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
