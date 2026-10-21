import { describe, expect, it, vi } from "vitest";

const prop = (name: string) => ({ playerName: name, propType: "Receiving Yards", sport: "NFL", date: "2026-10-25", gameStartTime: new Date("2026-10-25T17:00:00Z") });
const picks = [
  { id: "bad", isDemo: false, playerProp: prop("Poison Pick") },
  { id: "p2", isDemo: false, playerProp: prop("Second Player") },
  { id: "p3", isDemo: false, playerProp: prop("Third Player") },
];
const settled: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  prisma: { pick: { findMany: async () => picks, findUnique: async () => ({ status: "pending" }) } },
}));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ enableWebResearch: true }) }));
vi.mock("@/lib/generate", () => ({ propToScorable: (p: unknown) => p }));
vi.mock("@/lib/providers", () => ({
  settlementContext: () => ({ demo: false, enableWebResearch: true }),
  usableResult: () => true,
  lookupResult: async () => ({ actualResult: 50, source: "ESPN box score", resolved: true }),
}));
vi.mock("@/lib/settle", () => ({
  settlePickById: async (id: string) => {
    if (id === "bad") throw new Error("parlay leg references a missing pick");
    settled.push(id);
  },
}));
vi.mock("@/lib/providerCache", () => ({
  cacheGet: async () => null,
  cacheSet: async () => {},
  tryAcquireLock: async () => true,
  releaseLock: async () => {},
}));

const { runAutoSettle } = await import("./runAutoSettle");

describe("runAutoSettle", () => {
  it("settles every other pick when one throws, and names the one that failed", async () => {
    const line = await runAutoSettle("launchd", new Date("2026-10-25T22:00:00Z"));
    expect(settled).toEqual(["p2", "p3"]);
    expect(line).toContain("settled 2 of 3 due");
    expect(line).toContain("1 FAILED — bad (Poison Pick Receiving Yards): parlay leg references a missing pick");
  });
});
