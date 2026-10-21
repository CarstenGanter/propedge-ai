import { describe, expect, it } from "vitest";
import { redactKey, shouldLog } from "./oddsApiLedger";

describe("redactKey", () => {
  it("removes the API key wherever it sits in the query", () => {
    const base = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/abc/odds";
    expect(redactKey(`${base}?apiKey=SECRET&regions=us&markets=player_rush_yds`)).toBe(`${base}?regions=us&markets=player_rush_yds`);
    expect(redactKey(`${base}?regions=us&apiKey=SECRET&markets=h2h`)).toBe(`${base}?regions=us&markets=h2h`);
    expect(redactKey(`${base}?regions=us&apiKey=SECRET`)).toBe(`${base}?regions=us`);
    expect(redactKey(`${base}?apiKey=SECRET`)).toBe(base);
  });
});

describe("shouldLog", () => {
  it("logs every paid call and every timed-out or failed one, never a free call", () => {
    expect(shouldLog({ credits: 3, status: 200 })).toBe(true);
    expect(shouldLog({ credits: 1, status: 422 })).toBe(true);
    // Aborted after 9 s: the server may have charged it, so it's logged with an unknown cost.
    expect(shouldLog({ credits: null, status: 0 })).toBe(true);
    expect(shouldLog({ credits: 0, status: 200 })).toBe(false); // the events list
    expect(shouldLog({ credits: null, status: 200 })).toBe(false);
  });
});
