import { describe, expect, it } from "vitest";
import { underdogLineStamp } from "./venues";

const now = new Date("2026-10-25T16:40:00Z");

describe("underdogLineStamp", () => {
  it("stamps a new or moved line with the time and where it came from", () => {
    expect(underdogLineStamp({ line: null }, { line: 44.5, source: "feed" }, now)).toEqual({ underdogLineAt: now, underdogLineSource: "feed" });
    expect(underdogLineStamp({ line: 44.5 }, { line: 47.5, source: "manual" }, now)).toEqual({ underdogLineAt: now, underdogLineSource: "manual" });
  });

  it("keeps an unchanged line's original stamp, so a refresh never makes it look new", () => {
    expect(underdogLineStamp({ line: 44.5 }, { line: 44.5, source: "feed" }, now)).toEqual({});
  });

  it("clears the stamp when the line is cleared", () => {
    expect(underdogLineStamp({ line: 44.5 }, { line: null, source: null }, now)).toEqual({ underdogLineAt: null, underdogLineSource: null });
  });
});
