import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPlayerProps } from "./theOddsApi";

const soon = () => new Date(Date.now() + 3_600_000).toISOString();
const events = () => [
  { id: "ok", commence_time: soon(), home_team: "Atlanta Falcons", away_team: "Chicago Bears" },
  { id: "slow", commence_time: soon(), home_team: "Detroit Lions", away_team: "Green Bay Packers" },
];

function stub(handler: (url: string) => { status: number; body?: unknown; last?: number }) {
  vi.stubGlobal("fetch", async (url: string) => {
    const { status, body, last } = handler(url);
    const headers = new Headers({ "x-requests-remaining": "180", "x-requests-used": "320", ...(last != null ? { "x-requests-last": String(last) } : {}) });
    return new Response(body === undefined ? "error" : JSON.stringify(body), { status, headers });
  });
}

describe("fetchPlayerProps errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports a game that failed even when another game succeeded", async () => {
    const evs = events();
    stub((url) => {
      if (!url.includes("/odds")) return { status: 200, body: evs };
      if (url.includes("/events/slow/")) return { status: 500 };
      return { status: 200, body: { ...evs[0], bookmakers: [] }, last: 1 };
    });
    const r = await fetchPlayerProps("KEY", "NFL", { propTypes: ["Receiving Yards"] });
    expect(r.pricedEvents).toEqual([{ home: "Atlanta Falcons", away: "Chicago Bears" }]);
    expect(r.failedEvents).toEqual([expect.objectContaining({ home: "Detroit Lions", away: "Green Bay Packers" })]);
    expect(r.status.error).toContain("Green Bay Packers @ Detroit Lions");
  });

  it("reports the credit-regression stop even after a game came back", async () => {
    const evs = events();
    stub((url) => (url.includes("/odds") ? { status: 200, body: { ...evs[0], bookmakers: [] }, last: 5 } : { status: 200, body: evs }));
    const r = await fetchPlayerProps("KEY", "NFL", { propTypes: ["Receiving Yards"] });
    expect(r.pricedEvents).toHaveLength(1);
    expect(r.status.error).toContain("Credit regression");
  });

  it("calls a failed event list an error, not an empty slate", async () => {
    stub(() => ({ status: 503 }));
    const r = await fetchPlayerProps("KEY", "NFL", { propTypes: ["Receiving Yards"] });
    expect(r.status.ok).toBe(false);
    expect(r.status.error).toMatch(/event list failed \(503\)/);
  });
});
