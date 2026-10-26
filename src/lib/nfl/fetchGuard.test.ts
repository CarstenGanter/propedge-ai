import { describe, expect, it } from "vitest";
import { previousSlateFetch, refetchBlock } from "./fetchGuard";
import { toNflSlateDate } from "./slate";

// Sunday 2026-11-01: a 1 pm Eastern game and the 8:20 pm Eastern game (01:20Z on the 2nd).
const sunday = [
  { eventId: "e1", commenceTime: new Date("2026-11-01T18:00:00Z"), fetchedAt: new Date("2026-11-01T15:30:00Z") },
  { eventId: "e1", commenceTime: new Date("2026-11-01T18:00:00Z"), fetchedAt: new Date("2026-11-01T15:30:00Z") },
  { eventId: "e2", commenceTime: new Date("2026-11-02T01:20:00Z"), fetchedAt: new Date("2026-11-01T15:30:01Z") },
];
// Monday night's game is a different slate.
const monday = [{ eventId: "e3", commenceTime: new Date("2026-11-03T01:15:00Z"), fetchedAt: new Date("2026-11-02T20:00:00Z") }];

describe("previousSlateFetch", () => {
  it("finds the slate fetch for the date, by the games' slate date, with its game count", () => {
    const p = previousSlateFetch([...sunday, ...monday], "2026-11-01", toNflSlateDate)!;
    expect(p.games).toBe(2);
    expect(p.at).toEqual(new Date("2026-11-01T15:30:01Z"));
  });

  it("is null when nothing was fetched for that date", () => {
    expect(previousSlateFetch(sunday, "2026-11-02", toNflSlateDate)).toBeNull();
    expect(previousSlateFetch(monday, "2026-11-02", toNflSlateDate)!.games).toBe(1);
    expect(previousSlateFetch([], "2026-11-01", toNflSlateDate)).toBeNull();
  });
});

describe("refetchBlock", () => {
  const prev = { at: new Date("2026-11-01T15:30:01Z"), games: 12 };

  it("refuses a second fetch for the same date without the override", () => {
    expect(refetchBlock(prev, false)).toMatch(/Already fetched/);
  });

  it("lets it through with the explicit override, or when there was no fetch", () => {
    expect(refetchBlock(prev, true)).toBeNull();
    expect(refetchBlock(null, false)).toBeNull();
  });
});
