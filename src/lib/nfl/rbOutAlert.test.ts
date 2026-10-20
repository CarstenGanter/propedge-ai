import { describe, expect, it } from "vitest";
import { buildRbOutAlert, formatRbOutAlert, type AlertProp, type CarryShares } from "./rbOutAlert";
import { REDISTRIBUTION, redistribute } from "./vacatedVolume";

const prop = (o: Partial<AlertProp>): AlertProp => ({ playerName: "RB2", propType: "Rushing Yards", gsisId: "rb2", booksLine: 39.5, underdogLine: 37.5, prizePicksLine: 40.5, ...o });
const shares: CarryShares = new Map([
  ["rb1", { pos: "RB", prior: 0.55 }],
  ["rb2", { pos: "RB", prior: 0.25 }],
  ["qb", { pos: "QB", prior: 0.12 }],
]);

describe("buildRbOutAlert", () => {
  const alert = buildRbOutAlert({
    team: "Seattle Seahawks",
    outPlayer: { name: "RB1", gsisId: "rb1" },
    status: "out",
    props: [prop({}), prop({ propType: "Receiving Yards", playerName: "WR1", gsisId: "wr1" }), prop({ playerName: "RB1", gsisId: "rb1" })],
    shares,
  });

  it("lists teammates' rushing props only, never the out player's own", () => {
    expect(alert.teammates.map((t) => `${t.playerName} ${t.propType}`)).toEqual(["RB2 Rushing Yards"]);
  });

  it("gives each venue's gap to the books' line", () => {
    expect(alert.teammates[0]).toMatchObject({ underdogGap: -2, prizePicksGap: 1 });
  });

  it("expects the vacated carries to land by the fitted redistribution", () => {
    const expected = redistribute(
      [
        { id: "rb1", pos: "RB", prior: 0.55, active: false },
        { id: "rb2", pos: "RB", prior: 0.25, active: true },
        { id: "qb", pos: "QB", prior: 0.12, active: true },
      ],
      REDISTRIBUTION.carries,
    );
    expect(alert.vacatedShare).toBe(0.55);
    expect(alert.teammates[0].priorShare).toBe(0.25);
    expect(alert.teammates[0].expectedShare).toBeCloseTo(expected.get("rb2")!, 12);
    expect(alert.teammates[0].expectedShare!).toBeGreaterThan(0.6);
  });

  it("still lists lines when no carry shares are cached", () => {
    const bare = buildRbOutAlert({ team: "T", outPlayer: { name: "RB1", gsisId: null }, status: "out", props: [prop({})], shares: null });
    expect(bare.teammates[0]).toMatchObject({ underdogGap: -2, expectedShare: null });
  });
});

describe("formatRbOutAlert", () => {
  it("reads as one line per teammate prop", () => {
    const lines = formatRbOutAlert(
      buildRbOutAlert({ team: "Seattle Seahawks", outPlayer: { name: "Kenneth Walker", gsisId: "rb1" }, status: "out", props: [prop({ playerName: "Zach Charbonnet" })], shares }),
    );
    expect(lines[0]).toBe("RB Kenneth Walker (Seattle Seahawks) out, 55% of carries vacated → teammates' rushing lines");
    expect(lines[1]).toMatch(/^ {2}Zach Charbonnet Rushing Yards: books 39.5, Underdog 37.5 \(-2.0 vs books\), PrizePicks 40.5 \(\+1.0\); carries 25% → \d+%$/);
  });
});
