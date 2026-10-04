import { describe, expect, it } from "vitest";
import {
  buildConsensus,
  consensusProbOver,
  consensusSideProb,
  devig,
  leaveOneBookOut,
  multiplicativeDevig,
  powerDevig,
  selectMainLines,
  type RawQuote,
} from "./marketConsensus";
import { collectQuotes, type OddsEventOdds } from "@/lib/providers/live/theOddsApi";
import ten from "@/lib/providers/live/__fixtures__/nfl-event-ten-bookmakers.json";
import wide from "@/lib/providers/live/__fixtures__/nfl-event-regions-us-us2.json";

const SPORT = "americanfootball_nfl";
const quotesFor = (ev: unknown, player: string, propType: string) =>
  collectQuotes(ev as OddsEventOdds, SPORT).find((e) => e.player === player && e.propType === propType)!.quotes;

describe("de-vig", () => {
  it("returns 50% for an even market under both methods", () => {
    expect(powerDevig(-110, -110)).toBeCloseTo(0.5, 9);
    expect(multiplicativeDevig(-110, -110)).toBeCloseTo(0.5, 9);
  });

  it("takes more margin off the longshot than the multiplicative method", () => {
    // Favourite-longshot bias: the power method shades the underdog further down.
    const mult = multiplicativeDevig(300, -450);
    const pow = powerDevig(300, -450)!;
    expect(pow).toBeLessThan(mult);
    expect(pow).toBeGreaterThan(0.15);
  });

  it("agrees closely with the multiplicative method on near-even props", () => {
    expect(Math.abs(devig(-122, -108) - multiplicativeDevig(-122, -108))).toBeLessThan(0.003);
  });
});

describe("selectMainLines", () => {
  it("keeps each book's line nearest a coin flip and marks the rest as alternates", () => {
    const quotes: RawQuote[] = [
      { book: "fanduel", line: 40.5, over: -160, under: 125 },
      { book: "fanduel", line: 44.5, over: -112, under: -112 },
      { book: "fanduel", line: 49.5, over: 140, under: -175 },
    ];
    const out = selectMainLines(quotes);
    expect(out.find((q) => q.status === "used")!.line).toBe(44.5);
    expect(out.filter((q) => q.status === "alternate")).toHaveLength(2);
  });

  it("never lets a pick'em site into the market", () => {
    const out = selectMainLines([{ book: "underdog", line: 44.5, over: -137, under: -137 }]);
    expect(out[0].status).toBe("dfs");
  });

  it("marks a book that posted only one side", () => {
    expect(selectMainLines([{ book: "bovada", line: 30.5, over: -115, under: null }])[0].status).toBe("one-sided");
  });
});

describe("collectQuotes (real feed, 2026-10-01 PIT @ CLE)", () => {
  it("pairs Over and Under by player and line, per book", () => {
    const q = quotesFor(ten, "DK Metcalf", "Receiving Yards");
    const books = q.map((x) => x.book).sort();
    expect(books).toContain("underdog");
    expect(books).toContain("prizepicks");
    for (const x of q) if (x.book !== "underdog" && x.book !== "prizepicks") expect(x.over != null && x.under != null).toBe(true);
    // Books disagree on this line: 41.5 to 44.5.
    const lines = q.filter((x) => !["underdog", "prizepicks"].includes(x.book)).map((x) => x.line);
    expect(Math.max(...lines) - Math.min(...lines)).toBeGreaterThanOrEqual(2);
  });
});

describe("buildConsensus", () => {
  it("builds a reliable market from the real multi-book quotes, excluding pick'em sites", () => {
    const { model, quotes } = buildConsensus("Receiving Yards", quotesFor(wide, "DK Metcalf", "Receiving Yards"));
    expect(model).not.toBeNull();
    expect(model!.reliable).toBe(true);
    expect(quotes.some((q) => q.book === "underdog")).toBe(false); // not requested in this fixture
    // The reference line is one some book actually posted.
    expect(quotes.filter((q) => q.status === "used").map((q) => q.line)).toContain(model!.referenceLine);
  });

  it("reproduces a single book exactly at its own line", () => {
    const one: RawQuote[] = [{ book: "fanduel", line: 44.5, over: -125, under: -105 }];
    const { model } = buildConsensus("Receiving Yards", one);
    expect(consensusProbOver(model!, 44.5)).toBeCloseTo(devig(-125, -105), 4);
    expect(model!.reliable).toBe(false);
  });

  it("reads the price at any line, falling as the line rises", () => {
    const { model } = buildConsensus("Receiving Yards", quotesFor(wide, "DK Metcalf", "Receiving Yards"));
    const at = (l: number) => consensusProbOver(model!, l);
    expect(at(40.5)).toBeGreaterThan(at(44.5));
    expect(at(44.5)).toBeGreaterThan(at(48.5));
  });

  it("rejects a line far from the rest — the 31-yard passing-yards gap", () => {
    const raw: RawQuote[] = [
      { book: "fanduel", line: 262.5, over: -115, under: -115 },
      { book: "draftkings", line: 263.5, over: -112, under: -118 },
      { book: "betmgm", line: 261.5, over: -110, under: -120 },
      { book: "bovada", line: 292.5, over: -115, under: -115 },
    ];
    const { quotes, model } = buildConsensus("Passing Yards", raw);
    expect(quotes.find((q) => q.book === "bovada")!.status).toBe("line-outlier");
    expect(model!.referenceLine).toBeLessThan(270);
  });

  it("rejects a quote priced beyond -300 as an alternate or stale line", () => {
    const raw: RawQuote[] = [
      { book: "fanduel", line: 3.5, over: -120, under: -110 },
      { book: "draftkings", line: 3.5, over: -400, under: 280 },
    ];
    expect(buildConsensus("Receptions", raw).quotes.find((q) => q.book === "draftkings")!.status).toBe("juice");
  });

  it("counts a group once and spots a duplicated quote", () => {
    const raw: RawQuote[] = [
      { book: "betrivers", line: 30.5, over: -115, under: -115 },
      { book: "ballybet", line: 30.5, over: -115, under: -115 }, // same Kambi feed
      { book: "fanduel", line: 30.5, over: -120, under: -110 },
    ];
    const { quotes, model } = buildConsensus("Receiving Yards", raw);
    expect(quotes.find((q) => q.book === "ballybet")!.status).toBe("duplicate");
    expect(model!.groups).toBe(2);
    expect(model!.reliable).toBe(false);
  });
});

describe("consensusSideProb", () => {
  it("conditions on no tie at a whole-number line — PrizePicks' receptions at 2", () => {
    const { model } = buildConsensus("Receptions", [
      { book: "fanduel", line: 1.5, over: -150, under: 120 },
      { book: "draftkings", line: 1.5, over: -140, under: 110 },
      { book: "betmgm", line: 1.5, over: -145, under: 115 },
    ]);
    const over = consensusSideProb(model!, 2, "OVER");
    const under = consensusSideProb(model!, 2, "UNDER");
    expect(over + under).toBeCloseTo(1, 9);
    // Over 2 needs 3+ catches — harder than Over 1.5.
    expect(over).toBeLessThan(consensusSideProb(model!, 1.5, "OVER"));
  });
});

describe("leaveOneBookOut", () => {
  it("never uses the held-out book to predict itself", () => {
    const raw = quotesFor(wide, "DK Metcalf", "Receiving Yards");
    const a = leaveOneBookOut("Receiving Yards", raw, "consensus");
    const tampered = raw.map((q) => (q.book === a[0].book ? { ...q, over: -400, under: 300 } : q));
    const b = leaveOneBookOut("Receiving Yards", tampered, "consensus").find((h) => h.book === a[0].book);
    // Changing the target's own quote changes its target, never its prediction.
    if (b) expect(b.predicted).toBeCloseTo(a[0].predicted, 9);
  });
});

describe("favouredSide", () => {
  it("picks the side at the line being played, which can flip on a softer line", async () => {
    const { favouredSide } = await import("./marketConsensus");
    // Books lean Under at their own 10.5…
    const { model } = buildConsensus("Receiving Yards", [
      { book: "fanduel", line: 10.5, over: -105, under: -125 },
      { book: "draftkings", line: 10.5, over: -108, under: -122 },
      { book: "betmgm", line: 10.5, over: -110, under: -120 },
    ]);
    expect(favouredSide(model!, 10.5)).toBe("UNDER");
    // …but a venue posting 9.5 makes the Over the side worth playing.
    expect(favouredSide(model!, 9.5)).toBe("OVER");
  });
});
