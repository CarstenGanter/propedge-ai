import { describe, expect, it } from "vitest";
import { canReserve, classifyWindow, NEWS_TRIAL, planFetches, shouldExecute } from "./newsFetchTrial";

const et = (iso: string) => new Date(iso); // ISO strings below carry their UTC offset

describe("classifyWindow", () => {
  const sundayNoonET = et("2026-10-25T13:00:00-04:00");

  it("calls a change within two hours of kickoff game-day inactives", () => {
    expect(classifyWindow(et("2026-10-25T11:31:00-04:00"), sundayNoonET)).toBe("inactives");
  });

  it("calls a Friday change, Eastern time, the final injury report", () => {
    expect(classifyWindow(et("2026-10-23T16:15:00-04:00"), sundayNoonET)).toBe("friday");
    // 11:30 pm Thursday Pacific is already Friday in New York.
    expect(classifyWindow(et("2026-10-22T23:30:00-07:00"), sundayNoonET)).toBe("friday");
  });

  it("covers nothing else, and nothing after kickoff", () => {
    expect(classifyWindow(et("2026-10-24T10:00:00-04:00"), sundayNoonET)).toBeNull(); // Saturday
    expect(classifyWindow(et("2026-10-25T13:05:00-04:00"), sundayNoonET)).toBeNull();
  });
});

describe("canReserve", () => {
  const now = new Date("2026-10-23T20:00:00Z");

  it("reserves both fetches together", () => {
    expect(canReserve({ now, committed: 0, creditsRemaining: 200, creditFloor: 25 })).toEqual({ ok: true, credits: 6 });
  });

  it("refuses an event that would breach the 30-credit cap", () => {
    expect(canReserve({ now, committed: 24, creditsRemaining: 200, creditFloor: 25 }).ok).toBe(true);
    expect(canReserve({ now, committed: 25, creditsRemaining: 200, creditFloor: 25 })).toMatchObject({ ok: false });
  });

  it("refuses an event that would drop below the credit floor", () => {
    expect(canReserve({ now, committed: 0, creditsRemaining: 30, creditFloor: 25 })).toMatchObject({ ok: false });
  });

  it("refuses everything once the trial has ended", () => {
    expect(canReserve({ now: NEWS_TRIAL.endsAt, committed: 0, creditsRemaining: 200, creditFloor: 25 })).toMatchObject({ ok: false });
  });
});

describe("planFetches and shouldExecute", () => {
  it("plans fetches 10 and 40 minutes after the change was seen", () => {
    const seen = new Date("2026-10-25T15:31:00Z");
    expect(planFetches(seen).map((f) => [f.seq, (f.dueAt.getTime() - seen.getTime()) / 60_000])).toEqual([
      [1, 10],
      [2, 40],
    ]);
  });

  it("runs a fetch once due and never after kickoff", () => {
    const kickoff = new Date("2026-10-25T17:00:00Z");
    const due = new Date("2026-10-25T15:41:00Z");
    expect(shouldExecute(due, kickoff, new Date("2026-10-25T15:40:00Z"))).toMatchObject({ go: false });
    expect(shouldExecute(due, kickoff, new Date("2026-10-25T15:45:00Z"))).toEqual({ go: true });
    expect(shouldExecute(due, kickoff, new Date("2026-10-25T17:01:00Z"))).toMatchObject({ go: false, reason: "kickoff passed" });
  });
});
