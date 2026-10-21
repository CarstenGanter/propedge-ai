import { describe, expect, it } from "vitest";
import { CONTEXT_TTL, isFreshContext } from "./contextFreshness";

describe("isFreshContext", () => {
  const now = new Date("2026-10-23T20:00:00Z"); // Friday afternoon
  it("treats a report fetched within the context TTL as fresh", () => {
    expect(isFreshContext(new Date(now.getTime() - 10 * 60_000).toISOString(), now)).toBe(true);
    expect(isFreshContext(new Date(now.getTime() - CONTEXT_TTL).toISOString(), now)).toBe(true);
  });
  it("treats an older report — a Wednesday report reused on Friday — as stale", () => {
    expect(isFreshContext("2026-10-21T20:00:00.000Z", now)).toBe(false);
    expect(isFreshContext(new Date(now.getTime() - CONTEXT_TTL - 1).toISOString(), now)).toBe(false);
  });
  it("treats an unreadable timestamp as stale", () => {
    expect(isFreshContext("", now)).toBe(false);
  });
});
