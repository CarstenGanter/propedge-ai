import { afterEach, describe, expect, it, vi } from "vitest";

// A ledger write that outlasts the request's 9-second abort window.
const logged: { credits: number | null }[] = [];
vi.mock("./oddsApiLedger", () => ({
  reportOddsApiCall: async (call: { credits: number | null }) => {
    await vi.advanceTimersByTimeAsync(10_000);
    logged.push(call);
  },
}));

const { fetchMoneylines } = await import("./theOddsApiTeams");
const { listEvents } = await import("./theOddsApi");

/** A response whose body can no longer be read once its request was aborted — as with a real fetch. */
function stubFetch(body: unknown, headers: Record<string, string>) {
  vi.stubGlobal("fetch", async (_url: string, init: { signal: AbortSignal }) => ({
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: async () => {
      if (init.signal.aborted) throw new Error("AbortError: body read after abort");
      return body;
    },
    text: async () => JSON.stringify(body),
  }));
}

describe("the credit ledger write", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    logged.splice(0);
  });

  it("happens after the paid body is read, so a slow write can't abort it", async () => {
    vi.useFakeTimers();
    stubFetch([], { "x-requests-remaining": "190", "x-requests-last": "1" });
    const r = await fetchMoneylines("NFL", "KEY");
    expect(r.ok).toBe(true);
    expect(logged).toEqual([expect.objectContaining({ credits: 1, remaining: 190 })]);
  });

  it("applies to the props provider too", async () => {
    vi.useFakeTimers();
    stubFetch([{ id: "e1", commence_time: "2026-10-25T17:00:00Z", home_team: "A", away_team: "B" }], { "x-requests-remaining": "190", "x-requests-last": "0" });
    const r = await listEvents("KEY", "NFL");
    expect(r.events).toHaveLength(1);
    expect(r.status.ok).toBe(true);
  });
});
