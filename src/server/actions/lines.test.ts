import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { capture?: unknown; auto?: string[] } = {};
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/captureLines", () => ({
  captureClosingLines: async (opts: unknown) => {
    calls.capture = opts;
    return { ok: true, teamPicksUpdated: 1, propPicksUpdated: 0, creditsRemaining: 190 };
  },
}));
vi.mock("@/lib/nfl/runAutoCapture", () => ({
  runAutoCapture: async (source: string) => {
    (calls.auto ??= []).push(source);
    return "[2026-10-25T14:00:00.000Z] manual 2026-10-25: skip — no game with an uncaptured pick is 20-60 min from kickoff";
  },
}));
const { captureClosingLinesAction } = await import("./lines");

describe("captureClosingLinesAction", () => {
  beforeEach(() => {
    delete calls.capture;
    delete calls.auto;
  });

  it("never buys NFL prop lines itself: those go through the scheduled pass's window, lock and once-per-game rule", async () => {
    const r = await captureClosingLinesAction(true);
    expect(calls.capture).toMatchObject({ includeProps: true });
    expect((calls.capture as { sports: string[] }).sports).not.toContain("NFL");
    expect(calls.auto).toEqual(["manual"]);
    expect(r.message).toContain("NFL props: skip — no game with an uncaptured pick is 20-60 min from kickoff");
  });

  it("captures team lines only when props aren't asked for", async () => {
    await captureClosingLinesAction(false);
    expect(calls.auto).toBeUndefined();
  });
});
