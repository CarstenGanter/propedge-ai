import { describe, expect, it } from "vitest";
import { NFL_PROP_BOOKMAKERS, oddsTargetQuery, regionEquivalents } from "./oddsBooks";

describe("NFL_PROP_BOOKMAKERS", () => {
  it("bills as exactly one region, so credits stay flat", () => {
    expect(NFL_PROP_BOOKMAKERS).toHaveLength(10);
    expect(regionEquivalents({ bookmakers: NFL_PROP_BOOKMAKERS })).toBe(1);
  });
  it("includes both pick'em venues the app compares", () => {
    expect(NFL_PROP_BOOKMAKERS).toContain("underdog");
    expect(NFL_PROP_BOOKMAKERS).toContain("prizepicks");
  });
});

describe("oddsTargetQuery", () => {
  it("names bookmakers instead of a region", () => {
    const q = oddsTargetQuery({ bookmakers: NFL_PROP_BOOKMAKERS });
    expect(q.startsWith("bookmakers=")).toBe(true);
    expect(q).not.toContain("regions");
  });
  it("refuses an eleventh bookmaker rather than silently doubling the cost", () => {
    expect(() => oddsTargetQuery({ bookmakers: [...NFL_PROP_BOOKMAKERS, "fanatics"] })).toThrow();
  });
  it("still supports a plain region for other sports", () => {
    expect(oddsTargetQuery({ regions: "us" })).toBe("regions=us");
    expect(regionEquivalents({ regions: "us,us2" })).toBe(2);
  });
});
