import { describe, expect, it } from "vitest";
import { decideCapture, inCaptureWindow, minutesUntil, CAPTURE_WINDOW } from "./autoCapture";

const KICKOFF = "2026-09-25T00:15:00Z"; // Thursday 8:15 PM ET
const at = (iso: string) => new Date(iso);

describe("inCaptureWindow", () => {
  it("opens 60 minutes out and closes 20 minutes out", () => {
    expect(inCaptureWindow(KICKOFF, at("2026-09-24T23:14:00Z"))).toBe(false); // 61 min
    expect(inCaptureWindow(KICKOFF, at("2026-09-24T23:15:00Z"))).toBe(true); // 60 min
    expect(inCaptureWindow(KICKOFF, at("2026-09-24T23:55:00Z"))).toBe(true); // 20 min
    expect(inCaptureWindow(KICKOFF, at("2026-09-24T23:56:00Z"))).toBe(false); // 19 min
  });

  it("is closed once the game has started", () => {
    expect(inCaptureWindow(KICKOFF, at("2026-09-25T00:30:00Z"))).toBe(false);
  });

  it("always catches a game with a 15-minute cadence", () => {
    // Whatever minute the schedule happens to start on, some run lands inside.
    const kick = Date.parse(KICKOFF);
    for (let phase = 0; phase < 15; phase++) {
      // Runs every 15 minutes, starting `phase` minutes into a 2-hour lead-up.
      const runs = Array.from({ length: 8 }, (_, k) => new Date(kick - (120 - phase - 15 * k) * 60_000));
      expect(runs.some((now) => inCaptureWindow(KICKOFF, now))).toBe(true);
    }
    expect(CAPTURE_WINDOW.toMinutes - CAPTURE_WINDOW.fromMinutes).toBeGreaterThanOrEqual(15);
  });

  it("rejects an unparseable kickoff", () => {
    expect(minutesUntil("not a date", new Date())).toBeNull();
    expect(inCaptureWindow("not a date", new Date())).toBe(false);
  });
});

describe("decideCapture", () => {
  const inWindow = at("2026-09-24T23:30:00Z"); // 45 min out

  it("does nothing at all when every pick already has a closing line", () => {
    expect(decideCapture(0, [KICKOFF], inWindow)).toEqual({
      action: "skip",
      reason: "no uncaptured picks on this slate",
    });
  });

  it("waits until the window opens, and says when that is", () => {
    const d = decideCapture(4, [KICKOFF], at("2026-09-24T21:15:00Z")); // 3 hours out
    expect(d.action).toBe("skip");
    expect(d.action === "skip" && d.reason).toMatch(/next kickoff in 180 min/);
  });

  it("captures only the games that are due on a multi-window Sunday", () => {
    const early = "2026-09-27T17:00:00Z"; // 1:00 PM ET
    const late = "2026-09-27T20:25:00Z"; // 4:25 PM ET
    const night = "2026-09-28T00:20:00Z"; // 8:20 PM ET
    const d = decideCapture(9, [early, late, night], at("2026-09-27T16:20:00Z")); // 40 min before 1pm
    expect(d).toEqual({ action: "capture", kickoffs: [early] });
  });

  it("gives up cleanly once everything has kicked off", () => {
    const d = decideCapture(2, [KICKOFF], at("2026-09-25T01:00:00Z"));
    expect(d.action).toBe("skip");
  });
});
