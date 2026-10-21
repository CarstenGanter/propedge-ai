import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ enableWebResearch: true }) }));
vi.mock("@/lib/settle", () => ({ settlePickById: async () => ({ status: "miss" }) }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    pick: {
      findMany: async () => [
        { id: "a", playerProp: { playerName: "Snap Graded" } },
        { id: "b", playerProp: { playerName: "Still Waiting" } },
      ],
    },
  },
}));
vi.mock("@/lib/autoSettlePick", () => ({
  createSettler: () => ({
    settle: async (p: { id: string }) => (p.id === "a" ? { kind: "settled", via: "snap-counts" } : { kind: "waiting", reason: "nflverse has not posted the game yet" }),
  }),
}));
const { settleDailyPicks } = await import("./results");

describe("settleDailyPicks (Results page)", () => {
  it("settles through the same path as the auto-settle pass, snap-count grades included", async () => {
    const r = await settleDailyPicks("2026-10-15");
    expect(r.settled).toBe(1);
    expect(r.unresolved).toBe(1);
    expect(r.notes).toEqual([{ player: "Still Waiting", note: "Waiting: nflverse has not posted the game yet" }]);
  });
});
