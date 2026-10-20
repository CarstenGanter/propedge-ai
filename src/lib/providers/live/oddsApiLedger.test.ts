import { describe, expect, it } from "vitest";
import { redactKey } from "./oddsApiLedger";

describe("redactKey", () => {
  it("removes the API key wherever it sits in the query", () => {
    const base = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/abc/odds";
    expect(redactKey(`${base}?apiKey=SECRET&regions=us&markets=player_rush_yds`)).toBe(`${base}?regions=us&markets=player_rush_yds`);
    expect(redactKey(`${base}?regions=us&apiKey=SECRET&markets=h2h`)).toBe(`${base}?regions=us&markets=h2h`);
    expect(redactKey(`${base}?regions=us&apiKey=SECRET`)).toBe(`${base}?regions=us`);
    expect(redactKey(`${base}?apiKey=SECRET`)).toBe(base);
  });
});
