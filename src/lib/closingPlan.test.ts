import { afterEach, describe, expect, it, vi } from "vitest";
import { marketsForEvent } from "./closingPlan";
import { fetchPlayerProps } from "@/lib/providers/live/theOddsApi";

// Odds API props store the home side as `team`.
const picks = [
  { propType: "Receiving Yards", team: "Atlanta Falcons", opponent: "Chicago Bears" },
  { propType: "Rushing Yards", team: "Atlanta Falcons", opponent: "Chicago Bears" },
  { propType: "Receiving Yards", team: "Atlanta Falcons", opponent: "Chicago Bears" },
  { propType: "Passing Yards", team: "Dallas Cowboys", opponent: "Washington Commanders" },
];

describe("marketsForEvent", () => {
  it("buys only the prop types of that game's picks, once each", () => {
    expect(marketsForEvent(picks, { home_team: "Atlanta Falcons", away_team: "Chicago Bears" })).toEqual(["Receiving Yards", "Rushing Yards"]);
    expect(marketsForEvent(picks, { home_team: "Dallas Cowboys", away_team: "Washington Commanders" })).toEqual(["Passing Yards"]);
  });

  it("matches either orientation, and buys nothing for a game without a pick", () => {
    expect(marketsForEvent(picks, { home_team: "Washington Commanders", away_team: "Dallas Cowboys" })).toEqual(["Passing Yards"]);
    expect(marketsForEvent(picks, { home_team: "Detroit Lions", away_team: "Green Bay Packers" })).toEqual([]);
  });
});

describe("closing capture requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks each game for its own markets and never requests a game without a pick", async () => {
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const events = [
      { id: "atl", commence_time: soon, home_team: "Atlanta Falcons", away_team: "Chicago Bears" },
      { id: "det", commence_time: soon, home_team: "Detroit Lions", away_team: "Green Bay Packers" },
      { id: "dal", commence_time: soon, home_team: "Dallas Cowboys", away_team: "Washington Commanders" },
    ];
    const requested: { event: string; markets: string[] }[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const headers = new Headers({ "x-requests-remaining": "100", "x-requests-used": "400" });
      const odds = url.match(/events\/([^/]+)\/odds/);
      if (!odds) return new Response(JSON.stringify(events), { status: 200, headers });
      const markets = new URL(url).searchParams.get("markets")!.split(",");
      requested.push({ event: odds[1], markets: [...markets].sort() });
      headers.set("x-requests-last", String(markets.length));
      const ev = events.find((e) => e.id === odds[1])!;
      return new Response(JSON.stringify({ ...ev, bookmakers: [] }), { status: 200, headers });
    });

    const res = await fetchPlayerProps("KEY", "NFL", { maxEvents: 2, propTypesForEvent: (e) => marketsForEvent(picks, e) });
    expect(requested).toEqual([
      { event: "atl", markets: ["player_reception_yds", "player_rush_yds"] },
      { event: "dal", markets: ["player_pass_yds"] },
    ]);
    expect(res.pricedEvents).toHaveLength(2); // the pick-less game did not take a slot under the cap
  });
});
