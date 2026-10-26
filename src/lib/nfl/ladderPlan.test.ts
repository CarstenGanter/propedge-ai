import { describe, expect, it } from "vitest";
import { ladderPropTypesFor } from "./ladderPlan";

describe("ladderPropTypesFor", () => {
  it("buys rushing-yards ladders on the two approved Sundays only", () => {
    expect(ladderPropTypesFor("2026-11-01", null).propTypes).toEqual(["Rushing Yards"]);
    expect(ladderPropTypesFor("2026-11-08", 0).propTypes).toEqual([]);
    expect(ladderPropTypesFor("2026-10-29", null).propTypes).toEqual([]);
  });

  it("keeps Nov 22 when spend through Nov 15 is no more than 20 over plan", () => {
    expect(ladderPropTypesFor("2026-11-22", 20).propTypes).toEqual(["Rushing Yards"]);
    expect(ladderPropTypesFor("2026-11-22", -15).propTypes).toEqual(["Rushing Yards"]);
  });

  it("drops Nov 22 when spend through Nov 15 is more than 20 over plan, and says why", () => {
    const r = ladderPropTypesFor("2026-11-22", 21);
    expect(r.propTypes).toEqual([]);
    expect(r.note).toMatch(/21 over plan/);
  });

  it("asks for the Nov 15 drift on Nov 22, and needs none on Nov 1", () => {
    expect(() => ladderPropTypesFor("2026-11-22", null)).toThrow();
  });
});
