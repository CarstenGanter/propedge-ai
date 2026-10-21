import { describe, expect, it } from "vitest";
import { lookupResult, settlementContext, usableResult } from "./index";
import { DEMO_RESULT_SOURCE } from "./resultsProvider";

const settings = { demoMode: true, enableWebResearch: false };
const prop = { sport: "NFL", playerName: "Puka Nacua", team: "Los Angeles Rams", opponent: "Arizona Cardinals", propType: "Receiving Yards", line: 84.5, direction: "OVER", date: "2026-10-18" } as Parameters<typeof lookupResult>[0];

describe("settlementContext", () => {
  it("decides demo from the pick alone — the global demo switch never reaches a real pick", () => {
    expect(settlementContext({ isDemo: false }, settings).demo).toBe(false);
    const switchOff = { ...settings, demoMode: false };
    expect(settlementContext({ isDemo: true }, switchOff).demo).toBe(true);
  });

  it("sends a real pick to manual settlement, never to synthetic data, with the demo switch on", async () => {
    const r = await lookupResult(prop, settlementContext({ isDemo: false }, settings));
    expect(r.resolved).toBe(false);
    expect(r.source).not.toBe(DEMO_RESULT_SOURCE);
  });

  it("still gives demo picks their deterministic demo result", async () => {
    const r = await lookupResult(prop, settlementContext({ isDemo: true }, settings));
    expect(r).toMatchObject({ resolved: true, source: DEMO_RESULT_SOURCE });
  });
});

describe("usableResult", () => {
  const demo = { actualResult: 91, source: DEMO_RESULT_SOURCE, resolved: true };
  const espn = { actualResult: 91, source: "ESPN box score", resolved: true };

  it("refuses a synthetic result for a real pick, whatever context produced it", () => {
    expect(usableResult({ isDemo: false }, demo)).toBe(false);
    expect(usableResult({ isDemo: true }, demo)).toBe(true);
    expect(usableResult({ isDemo: false }, espn)).toBe(true);
  });

  it("refuses an unresolved or empty lookup", () => {
    expect(usableResult({ isDemo: false }, { ...espn, resolved: false })).toBe(false);
    expect(usableResult({ isDemo: false }, { ...espn, actualResult: null })).toBe(false);
  });
});
