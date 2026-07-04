import { describe, expect, it } from "vitest";
import {
  moneylinePayout,
  settleParlay,
  settleProp,
  settleSingle,
  settleTeamMoneyline,
  settleTeamResult,
} from "./settlement";

describe("settleProp", () => {
  it("settles OVER correctly", () => {
    expect(settleProp(25.5, "OVER", 27)).toBe("hit");
    expect(settleProp(25.5, "OVER", 24)).toBe("miss");
  });
  it("settles UNDER correctly", () => {
    expect(settleProp(25.5, "UNDER", 24)).toBe("hit");
    expect(settleProp(25.5, "UNDER", 27)).toBe("miss");
  });
  it("returns push on an exact line and pending when unknown", () => {
    expect(settleProp(25, "OVER", 25)).toBe("push");
    expect(settleProp(25, "OVER", null)).toBe("pending");
  });
});

describe("settleSingle", () => {
  it("computes even-money win/loss", () => {
    expect(settleSingle(5, "hit")).toMatchObject({ payout: 10, profitLoss: 5, status: "won" });
    expect(settleSingle(5, "miss")).toMatchObject({ payout: 0, profitLoss: -5, status: "lost" });
  });
  it("honors a payout multiplier", () => {
    expect(settleSingle(5, "hit", 1.5)).toMatchObject({ payout: 7.5, profitLoss: 2.5 });
  });
  it("returns stake on push/void", () => {
    expect(settleSingle(5, "push")).toMatchObject({ profitLoss: 0, status: "push" });
    expect(settleSingle(5, "void")).toMatchObject({ profitLoss: 0, status: "void" });
  });
});

describe("settleParlay", () => {
  it("pays stake * multiplier when all legs hit", () => {
    const r = settleParlay(5, 10, ["hit", "hit", "hit"]);
    expect(r.status).toBe("won");
    expect(r.payout).toBe(50);
    expect(r.profitLoss).toBe(45);
  });
  it("loses the stake if any leg misses", () => {
    const r = settleParlay(5, 10, ["hit", "miss", "hit"]);
    expect(r.status).toBe("lost");
    expect(r.profitLoss).toBe(-5);
  });
  it("stays pending until all legs decided", () => {
    expect(settleParlay(5, 10, ["hit", "pending"]).status).toBe("pending");
  });
  it("reduces multiplier when a leg is voided", () => {
    const r = settleParlay(5, 9, ["hit", "hit", "void"]);
    expect(r.status).toBe("won");
    expect(r.effectiveMultiplier).toBeLessThan(9);
    expect(r.effectiveMultiplier).toBeGreaterThan(1);
  });
});

describe("moneyline", () => {
  it("computes profit from American odds", () => {
    expect(moneylinePayout(10, 150)).toBeCloseTo(15, 5); // +150 → $15 on $10
    expect(moneylinePayout(10, -200)).toBeCloseTo(5, 5); // -200 → $5 on $10
  });

  it("settles a team moneyline win/loss/push", () => {
    expect(settleTeamMoneyline(5, 200, "win")).toMatchObject({ profitLoss: 10, status: "won" });
    expect(settleTeamMoneyline(5, -150, "loss")).toMatchObject({ profitLoss: -5, status: "lost" });
    expect(settleTeamMoneyline(5, -150, "push")).toMatchObject({ profitLoss: 0, status: "push" });
  });

  it("grades team result vs the recommended side", () => {
    expect(settleTeamResult("HOME", "HOME")).toBe("win");
    expect(settleTeamResult("HOME", "AWAY")).toBe("loss");
    expect(settleTeamResult("AWAY", "DRAW")).toBe("loss");
    expect(settleTeamResult("HOME", null)).toBe("pending");
  });
});
