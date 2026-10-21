import { describe, expect, it } from "vitest";
import { runSteps } from "./schedulerSteps";

describe("runSteps", () => {
  it("runs every step even when an earlier one throws, and reports which failed", async () => {
    const ran: string[] = [];
    const results = await runSteps(
      [
        ["capture", async () => { ran.push("capture"); throw new Error("saveQuotes: database is locked"); }],
        ["settle", async () => { ran.push("settle"); return "settled 3 of 3 due"; }],
        ["injury-watch", async () => { ran.push("injury-watch"); return "skip — no changes"; }],
      ],
      () => new Date("2026-10-25T16:15:00Z"),
    );
    expect(ran).toEqual(["capture", "settle", "injury-watch"]);
    expect(results.map((r) => r.ok)).toEqual([false, true, true]);
    expect(results[0].line).toMatch(/^\[2026-10-25T16:15:00.000Z\] capture FAILED: Error: saveQuotes: database is locked/);
    expect(results[1].line).toBe("settled 3 of 3 due");
  });
});
