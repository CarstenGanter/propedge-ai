import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const created: Record<string, unknown>[] = [];
vi.mock("@/lib/db/client", () => ({
  prisma: { creditSpend: { create: async ({ data }: { data: Record<string, unknown> }) => created.push(data) } },
}));

const { logOddsApiCall, withCreditKind } = await import("./creditLedger");
const call = { url: "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?regions=us&markets=h2h", credits: 3, remaining: 196, status: 200 };

describe("credit ledger", () => {
  beforeEach(() => void created.splice(0));

  it("logs a call under the kind of fetch that made it, with its exact cost and the balance after", async () => {
    await withCreditKind("closing", () => logOddsApiCall(call));
    expect(created[0]).toMatchObject({ kind: "closing", credits: 3, remaining: 196, status: 200, endpoint: "/sports/americanfootball_nfl/odds?regions=us&markets=h2h" });
  });

  it("logs a call no caller tagged as untagged, so nothing spends unseen", async () => {
    await logOddsApiCall(call);
    expect(created[0]).toMatchObject({ kind: "untagged" });
  });

  it("lets the innermost tag win and keeps tags apart across concurrent work", async () => {
    await withCreditKind("daily", async () => {
      await Promise.all([withCreditKind("slate", () => logOddsApiCall(call)), withCreditKind("alt", () => logOddsApiCall(call))]);
      await logOddsApiCall(call);
    });
    expect(created.map((c) => c.kind).sort()).toEqual(["alt", "daily", "slate"]);
  });
});
