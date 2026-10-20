import { describe, expect, it } from "vitest";
import { consensusAsOf, quotesAsOf, sideProbsAtLine, type StoredOddsQuote } from "./quoteHistory";
import { buildConsensus, consensusProbOver } from "./marketConsensus";
import { collectQuotes, flattenEventQuotes } from "@/lib/providers/live/theOddsApi";
import { consensusOf, type MarketSnapshot } from "@/lib/marketSnapshot";
import ev from "@/lib/providers/live/__fixtures__/nfl-event-ten-bookmakers.json";

const t = (h: number) => new Date(Date.UTC(2026, 9, 18, h));
const q = (book: string, line: number, over: number, under: number, fetchedHour: number): StoredOddsQuote => ({
  book,
  line,
  over,
  under,
  fetchedAt: t(fetchedHour),
  bookUpdatedAt: null,
});

describe("quotesAsOf", () => {
  const history = [
    q("fanduel", 44.5, -110, -110, 9),
    q("fanduel", 46.5, -110, -110, 17), // moved after the slate fetch
    q("draftkings", 44.5, -115, -105, 9),
    q("draftkings", 39.5, -200, 160, 9), // an alternate in the same fetch
  ];

  it("uses each book's latest fetch at or before the moment, never a later one", () => {
    const asOf10 = quotesAsOf(history, t(10));
    expect(asOf10.filter((x) => x.book === "fanduel").map((x) => x.line)).toEqual([44.5]);
    expect(quotesAsOf(history, t(18)).filter((x) => x.book === "fanduel").map((x) => x.line)).toEqual([46.5]);
  });

  it("keeps a book's quotes from one fetch together", () => {
    expect(quotesAsOf(history, t(10)).filter((x) => x.book === "draftkings").map((x) => x.line).sort()).toEqual([39.5, 44.5]);
  });

  it("has nothing before the first fetch", () => {
    expect(quotesAsOf(history, t(8))).toEqual([]);
    expect(consensusAsOf("Receiving Yards", history, t(8))).toBeNull();
  });

  it("moves the consensus only with what had been fetched by then", () => {
    const morning = consensusAsOf("Receiving Yards", history, t(10))!;
    const evening = consensusAsOf("Receiving Yards", history, t(18))!;
    expect(evening.mean).toBeGreaterThan(morning.mean);
  });
});

describe("staleness survives a rebuild from stored quotes", () => {
  const fresh = "2026-10-18T15:00:00Z";
  const stale = "2026-10-18T05:00:00Z"; // 10h older than the freshest
  const snap = (withTimes: boolean): MarketSnapshot => ({
    v: 2,
    consensus: buildConsensus("Receiving Yards", [{ book: "fanduel", line: 44.5, over: -110, under: -110 }]).model!,
    quotes: [
      { book: "fanduel", line: 44.5, over: -110, under: -110, status: "used", ...(withTimes ? { lastUpdate: fresh } : {}) },
      { book: "draftkings", line: 44.5, over: -110, under: -110, status: "used", ...(withTimes ? { lastUpdate: fresh } : {}) },
      { book: "betmgm", line: 48.5, over: -110, under: -110, status: "used", ...(withTimes ? { lastUpdate: stale } : {}) },
    ],
  });

  it("halves the stale book's weight only when its time was stored", () => {
    const weighted = consensusOf(snap(true))!;
    const unweighted = consensusOf(snap(false))!;
    // The stale book quotes a higher line; halving its weight pulls the mean down.
    expect(weighted.mean).toBeLessThan(unweighted.mean);
  });
});

describe("sideProbsAtLine", () => {
  const entry = buildConsensus("Receiving Yards", [{ book: "fanduel", line: 14.5, over: -110, under: -110 }]).model!;
  const close = buildConsensus("Receiving Yards", [{ book: "fanduel", line: 14.5, over: -125, under: 105 }]).model!;

  it("reads entry and close at one line, for the side played", () => {
    const r = sideProbsAtLine(entry, close, 15.5, "UNDER");
    expect(r.entryProb).toBeCloseTo(1 - consensusProbOver(entry, 15.5), 12);
    expect(r.closingProb).toBeCloseTo(1 - consensusProbOver(close, 15.5), 12);
    // The market moved toward the Over, so the Under's closing probability fell.
    expect(r.closingProb!).toBeLessThan(r.entryProb!);
  });

  it("is null where a side has no market", () => {
    expect(sideProbsAtLine(null, close, 14.5, "OVER").entryProb).toBeNull();
  });
});

describe("flattenEventQuotes", () => {
  it("keeps every quote of a real feed event, with its event", () => {
    const flat = flattenEventQuotes(ev as never, "americanfootball_nfl", "evt-1");
    const expected = collectQuotes(ev as never, "americanfootball_nfl").reduce((n, e) => n + e.quotes.length, 0);
    expect(flat).toHaveLength(expected);
    expect(flat[0]).toMatchObject({ eventId: "evt-1", homeTeam: (ev as { home_team: string }).home_team, sportKey: "americanfootball_nfl" });
    // Pick'em venues are stored too: the store keeps what was fetched.
    expect(flat.some((x) => x.book === "underdog")).toBe(true);
  });
});
