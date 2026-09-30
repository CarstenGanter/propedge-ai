import { describe, expect, it } from "vitest";
import {
  bestPrizePicksSide,
  mergeAvailability,
  mergeUnderdogLine,
  prizePicksValue,
  PRIZEPICKS_LEG_BAR,
  readVenueLine,
  underdogValue,
} from "./venues";
import { buildConsensus } from "./marketConsensus";
import { normalizeEvent } from "@/lib/providers/live/theOddsApi";
import ev from "@/lib/providers/live/__fixtures__/nfl-event-ten-bookmakers.json";

describe("mergeUnderdogLine", () => {
  it("never overwrites a line the user typed", () => {
    expect(mergeUnderdogLine({ line: 43.5, source: "manual" }, 44.5)).toEqual({ line: 43.5, source: "manual" });
  });
  it("treats a line typed before sources were recorded as manual", () => {
    expect(mergeUnderdogLine({ line: 43.5, source: null }, 44.5)).toEqual({ line: 43.5, source: "manual" });
  });
  it("fills a blank and refreshes its own earlier value", () => {
    expect(mergeUnderdogLine({ line: null, source: null }, 44.5)).toEqual({ line: 44.5, source: "feed" });
    expect(mergeUnderdogLine({ line: 44.5, source: "feed" }, 45.5)).toEqual({ line: 45.5, source: "feed" });
  });
  it("keeps the last feed value when the feed goes quiet", () => {
    expect(mergeUnderdogLine({ line: 44.5, source: "feed" }, undefined)).toEqual({ line: 44.5, source: "feed" });
    expect(mergeUnderdogLine({ line: null, source: null }, undefined)).toEqual({ line: null, source: null });
  });
});

describe("mergeAvailability", () => {
  it("marks seen props as offered but never infers 'not offered' from silence", () => {
    expect(mergeAvailability(null, 44.5)).toBe(true);
    expect(mergeAvailability(null, undefined)).toBeNull();
    expect(mergeAvailability(false, 44.5)).toBe(false); // the user said so
  });
});

describe("reading venue lines (real feed)", () => {
  const props = normalizeEvent(ev as never, "americanfootball_nfl", "NFL");
  const metcalf = props.find((p) => p.playerName === "DK Metcalf" && p.propType === "Receiving Yards")!;

  it("sees PrizePicks' 41.5 on Metcalf as a softer Over than the books' line", () => {
    const read = readVenueLine(metcalf.consensus!, 41.5, "OVER");
    expect(read.lineGap).toBeLessThan(0);
    expect(read.flag).toBe("soft");
    expect(read.probAtVenue).toBeGreaterThan(read.probAtReference);
  });

  it("picks the side the books favour at PrizePicks' line", () => {
    const { dir, read } = bestPrizePicksSide(metcalf.consensus!, 41.5);
    expect(dir).toBe("OVER");
    expect(prizePicksValue(read)).toBeCloseTo(read.probAtVenue / PRIZEPICKS_LEG_BAR, 12);
  });

  it("values an Underdog line at the entered payout, standard when blank", () => {
    const read = readVenueLine(metcalf.consensus!, 44.5, "OVER");
    expect(underdogValue(read, null)).toBeCloseTo(read.probAtVenue * 1.87, 12);
    expect(underdogValue(read, 1.54)).toBeLessThan(underdogValue(read, null));
  });

  it("flags nothing when the venue posts the books' own line", () => {
    const { model } = buildConsensus("Receiving Yards", [
      { book: "fanduel", line: 30.5, over: -115, under: -115 },
      { book: "draftkings", line: 30.5, over: -112, under: -118 },
    ]);
    expect(readVenueLine(model!, 30.5, "OVER").flag).toBe("none");
  });
});
