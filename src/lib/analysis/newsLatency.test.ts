import { describe, expect, it } from "vitest";
import { bookMoves, latencyByGroup, type TimedQuote } from "./newsLatency";

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
