import { describe, expect, it } from "vitest";
import { parsePropsCsv, prepareRow } from "./props";

const HEADER =
  "sport,league,gameDate,playerName,team,opponent,propType,line,overUnder";

describe("prepareRow", () => {
  it("normalizes a valid row", () => {
    const res = prepareRow({
      sport: "nba",
      league: "NBA",
      gameDate: "2026-06-30",
      playerName: "Jalen Brunson",
      team: "Knicks",
      opponent: "Celtics",
      propType: "Points",
      line: "25.5",
      overUnder: "over",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.sport).toBe("NBA");
      expect(res.value.direction).toBe("OVER");
      expect(res.value.line).toBe(25.5);
    }
  });

  it("rejects a bad direction", () => {
    const res = prepareRow({
      sport: "NBA",
      league: "NBA",
      gameDate: "2026-06-30",
      playerName: "X",
      team: "A",
      opponent: "B",
      propType: "Points",
      line: "20",
      overUnder: "sideways",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects an invalid date", () => {
    const res = prepareRow({
      sport: "NBA",
      league: "NBA",
      gameDate: "06/30/2026",
      playerName: "X",
      team: "A",
      opponent: "B",
      propType: "Points",
      line: "20",
      overUnder: "over",
    });
    expect(res.ok).toBe(false);
  });
});

describe("parsePropsCsv", () => {
  it("imports valid rows and reports bad ones", () => {
    const csv = `${HEADER}\nNBA,NBA,2026-06-30,A,T1,T2,Points,25.5,OVER\nNBA,NBA,2026-06-30,B,T1,T2,Points,notanumber,OVER`;
    const { valid, errors } = parsePropsCsv(csv);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
  });

  it("fails fast on missing required columns", () => {
    const { valid, errors } = parsePropsCsv("sport,league\nNBA,NBA");
    expect(valid).toHaveLength(0);
    expect(errors[0].message).toMatch(/Missing required column/);
  });
});
