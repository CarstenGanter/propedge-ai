import { describe, expect, it } from "vitest";
import { bookMoves, isMove, latencyByGroup, propChangesBetween, summarizeChanges, venueGapsAtFetch, type TimedQuote } from "./newsLatency";

const at = (min: number) => new Date(Date.UTC(2026, 9, 25, 15, 0) + min * 60_000);
const q = (book: string, line: number, fetchMin: number, o: Partial<TimedQuote> = {}): TimedQuote => ({
  book,
  key: "Teammate|Receiving Yards",
  line,
  over: -110,
  under: -110,
  fetchedAt: at(fetchMin),
  bookUpdatedAt: null,
  ...o,
});
const news = at(0);

describe("bookMoves", () => {
  it("times the first fetch after the news that shows a move", () => {
    const moves = bookMoves([q("fanduel", 44.5, -60), q("fanduel", 44.5, 20), q("fanduel", 49.5, 45), q("fanduel", 51.5, 90)], news);
    expect(moves).toEqual([{ book: "fanduel", group: "fanduel", key: "Teammate|Receiving Yards", minutes: 45, bookMinutes: null, observedMinutes: 45 }]);
  });

  it("counts a price change as a move and reads the book's own timestamp when it is after the news", () => {
    const moves = bookMoves([q("draftkings", 44.5, -30), q("draftkings", 44.5, 40, { over: -140, under: 110, bookUpdatedAt: at(12) })], news);
    expect(moves[0]).toMatchObject({ minutes: 40, bookMinutes: 12 });
  });

  it("is censored when nothing moved by the last look — never a latency", () => {
    const moves = bookMoves([q("underdog", 44.5, -30), q("underdog", 44.5, 50)], news);
    expect(moves[0]).toMatchObject({ group: "underdog", minutes: null, observedMinutes: 50 });
  });

  it("needs a quote before the news and one after", () => {
    expect(bookMoves([q("fanduel", 44.5, 10), q("fanduel", 49.5, 30)], news)).toEqual([]);
    expect(bookMoves([q("fanduel", 44.5, -10)], news)).toEqual([]);
  });

  it("leaves out a book with several lines in one fetch (alternates)", () => {
    expect(bookMoves([q("fanduel", 44.5, -10), q("fanduel", 54.5, -10), q("fanduel", 49.5, 30)], news)).toEqual([]);
  });
});

describe("latencyByGroup", () => {
  it("summarises moves per venue group, with a floor for the ones that hadn't moved", () => {
    const moves = bookMoves(
      [
        q("fanduel", 44.5, -10), q("fanduel", 49.5, 30),
        q("betrivers", 44.5, -10), q("betrivers", 48.5, 60),
        q("ballybet", 44.5, -10), q("ballybet", 44.5, 60),
        q("prizepicks", 44.5, -10), q("prizepicks", 44.5, 30),
      ],
      news,
    );
    const g = latencyByGroup(moves);
    expect(g.find((x) => x.group === "fanduel")).toMatchObject({ props: 1, moved: 1, medianMinutes: 30 });
    expect(g.find((x) => x.group === "kambi")).toMatchObject({ props: 2, moved: 1, medianMinutes: 60, censoredAtLeast: 60 });
    expect(g.find((x) => x.group === "prizepicks")).toMatchObject({ moved: 0, medianMinutes: null, censoredAtLeast: 30 });
  });
});

describe("venueGapsAtFetch", () => {
  it("puts each venue's line beside the books' consensus line at one fetch", () => {
    const quotes = [q("fanduel", 49.5, 10), q("draftkings", 49.5, 10), q("underdog", 44.5, 10), q("prizepicks", 46.5, 10)];
    const rows = venueGapsAtFetch(quotes, (_t, books) => books[0].line);
    expect(rows).toEqual([{ key: "Teammate|Receiving Yards", books: 49.5, underdog: 44.5, prizepicks: 46.5 }]);
  });
});

describe("isMove", () => {
  const base = { line: 44.5, over: -110, under: -110 };
  it("counts any line change", () => {
    expect(isMove(base, { ...base, line: 45.5 })).toBe(true);
  });
  it("ignores routine price ticks, counts a real re-price", () => {
    expect(isMove(base, { ...base, over: -115, under: -105 })).toBe(false); // one tick: ~1.1 pts
    expect(isMove(base, { ...base, over: -120, under: 100 })).toBe(false); // two ticks: ~2.2 pts
    expect(isMove(base, { ...base, over: -125, under: 105 })).toBe(true); // three ticks: ~3.2 pts
  });
  it("counts only line changes where prices are placeholders (venues)", () => {
    expect(isMove({ line: 44.5, over: null, under: null }, { line: 44.5, over: null, under: null })).toBe(false);
    expect(isMove({ line: 44.5, over: null, under: null }, { line: 41.5, over: null, under: null })).toBe(true);
  });
});

describe("propChangesBetween + summarizeChanges", () => {
  it("compares each book's quote of each prop between the +10 and +40 fetches, per venue", () => {
    const f1 = [q("underdog", 44.5, 10, { over: null, under: null }), q("fanduel", 47.5, 10), q("draftkings", 47.5, 10)];
    const f2 = [q("underdog", 49.5, 40, { over: null, under: null }), q("fanduel", 49.5, 40), q("draftkings", 47.5, 40, { over: -112, under: -108 })];
    const rows = propChangesBetween(f1, f2);
    expect(rows).toHaveLength(3);
    const s = summarizeChanges(rows);
    expect(s.find((g) => g.group === "underdog")).toEqual({ group: "underdog", props: 1, moved: 1, meanLineChange: 5 });
    expect(s.find((g) => g.group === "fanduel")).toMatchObject({ moved: 1, meanLineChange: 2 });
    expect(s.find((g) => g.group === "draftkings")).toMatchObject({ moved: 0, meanLineChange: 0 });
  });
  it("leaves out a book quoting several lines (alternates) in either fetch", () => {
    expect(propChangesBetween([q("fanduel", 44.5, 10), q("fanduel", 54.5, 10)], [q("fanduel", 49.5, 40)])).toEqual([]);
  });
});
