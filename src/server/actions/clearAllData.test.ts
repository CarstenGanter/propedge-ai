import { beforeEach, describe, expect, it, vi } from "vitest";

const deleted: string[] = [];
const model = (name: string) => ({ deleteMany: async () => void deleted.push(name) });
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/settings", () => ({ saveSettings: async () => {} }));
vi.mock("@/lib/demoSeed", () => ({ seedDemoData: async () => ({}), clearDemoDataPublic: async () => {} }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    bankrollEntry: model("bankrollEntry"),
    parlay: model("parlay"),
    pick: model("pick"),
    playerProp: model("playerProp"),
    propPrediction: model("propPrediction"),
    oddsQuote: model("oddsQuote"),
    avoidListItem: model("avoidListItem"),
  },
}));
const backup = vi.fn();
vi.mock("@/lib/db/backup", () => ({ backupConfiguredDatabase: () => backup() }));

const { clearAllDataAction } = await import("./settings");

describe("clearAllDataAction", () => {
  beforeEach(() => {
    deleted.splice(0);
    backup.mockReset();
  });

  it("backs up first, then clears picks, slips, bankroll and the avoid list — never props, forecasts or odds", async () => {
    backup.mockReturnValue({ backup: { path: "/repo/prisma/backups/dev-20261021-120000Z.db" }, offsite: null });
    const r = await clearAllDataAction();
    expect(r.ok).toBe(true);
    expect(r.message).toContain("dev-20261021-120000Z.db");
    expect(deleted.sort()).toEqual(["avoidListItem", "bankrollEntry", "parlay", "pick"]);
  });

  it("deletes nothing when the backup fails", async () => {
    backup.mockImplementation(() => {
      throw new Error("disk full");
    });
    const r = await clearAllDataAction();
    expect(r).toEqual({ ok: false, message: "Nothing deleted: the database backup failed (disk full)." });
    expect(deleted).toEqual([]);
  });
});
