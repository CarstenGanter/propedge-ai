import { describe, expect, it } from "vitest";
import { decideCapture, inCaptureWindow, minutesUntil, CAPTURE_WINDOW, type UncapturedGame } from "./autoCapture";

const KICKOFF = "2026-09-25T00:15:00Z"; // Thursday 8:15 PM ET
const at = (iso: string) => new Date(iso);
const game = (gameId: string, kickoffISO: string, picks = 1): UncapturedGame => ({
  gameId,
  kickoffISO,
  home: `Home ${gameId}`,
  away: `Away ${gameId}`,
  picks,
});
const NONE = new Set<string>();

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
    const kick = Date.parse(KICKOFF);
    for (let phase = 0; phase < 15; phase++) {
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
  const early = "2026-09-27T17:00:00Z"; // 1:00 PM ET
  const late = "2026-09-27T20:25:00Z"; // 4:25 PM ET

  it("does nothing when every pick already has a closing line", () => {
    expect(decideCapture([], NONE, at("2026-09-27T16:30:00Z"))).toEqual({
      action: "skip",
      reason: "no uncaptured picks on this slate",
    });
  });

  it("captures only the games that are due", () => {
    const d = decideCapture([game("a", early), game("b", late)], NONE, at("2026-09-27T16:20:00Z"));
    expect(d).toEqual({ action: "capture", games: [game("a", early)] });
  });

  // The 2026-09-27 bug: the only uncaptured picks were in the 4:25 games, but
  // 1pm games were in the window, so it re-bought every 1pm game. Only games
  // that hold an uncaptured pick may ever be fetched.
  it("does not fetch a game in the window when its picks are already captured", () => {
    const d = decideCapture([game("late", late)], NONE, at("2026-09-27T16:15:00Z"));
    expect(d.action).toBe("skip");
    expect(d.action === "skip" && d.reason).toMatch(/next game with uncaptured picks in 250 min/);
  });

  // The other half: a pick that never matches (prop pulled) must not re-buy
  // its game every 15 minutes.
  it("never attempts the same game twice", () => {
    const d = decideCapture([game("a", early)], new Set(["a"]), at("2026-09-27T16:30:00Z"));
    expect(d).toEqual({
      action: "skip",
      reason: "1 game(s) in the window were already attempted — not paying twice",
    });
  });

  it("gives up cleanly once everything has kicked off", () => {
    expect(decideCapture([game("a", early)], NONE, at("2026-09-27T18:00:00Z")).action).toBe("skip");
  });
});
