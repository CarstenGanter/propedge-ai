import { describe, expect, it } from "vitest";
import { dueForSettlement, settleRetryDue, staleForAutoSettle } from "./settleSchedule";

const SNF = "2026-09-28T00:20:00Z"; // Sunday 8:20 PM ET

describe("dueForSettlement", () => {
  it("waits three and a half hours after kickoff", () => {
    expect(dueForSettlement(SNF, "2026-09-27", "2026-09-27", new Date("2026-09-28T03:40:00Z"))).toBe(false); // 3h20
    expect(dueForSettlement(SNF, "2026-09-27", "2026-09-27", new Date("2026-09-28T03:50:00Z"))).toBe(true); // 3h30
  });

  it("settles the early games the same afternoon, before the night game is due", () => {
    const now = new Date("2026-09-27T21:00:00Z"); // 5:00 PM ET
    expect(dueForSettlement("2026-09-27T17:00:00Z", "2026-09-27", "2026-09-27", now)).toBe(true); // 1pm game
    expect(dueForSettlement(SNF, "2026-09-27", "2026-09-27", now)).toBe(false);
  });

  it("without a kickoff time, waits until the slate is over", () => {
    expect(dueForSettlement(null, "2026-09-27", "2026-09-27", new Date())).toBe(false);
    expect(dueForSettlement(null, "2026-09-27", "2026-09-28", new Date())).toBe(true);
  });
});

describe("settleRetryDue", () => {
  it("retries at most every 30 minutes", () => {
    const now = new Date("2026-09-28T04:00:00Z");
    expect(settleRetryDue(null, now)).toBe(true);
    expect(settleRetryDue("2026-09-28T03:45:00Z", now)).toBe(false);
    expect(settleRetryDue("2026-09-28T03:30:00Z", now)).toBe(true);
  });
});

describe("staleForAutoSettle", () => {
  it("stops retrying a pick ESPN still can't grade after three days", () => {
    expect(staleForAutoSettle("2026-09-27", "2026-09-28")).toBe(false);
    expect(staleForAutoSettle("2026-09-25", "2026-09-28")).toBe(false); // exactly 3 days
    expect(staleForAutoSettle("2026-09-10", "2026-09-28")).toBe(true);
  });
});
