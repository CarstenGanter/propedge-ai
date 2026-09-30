import { describe, expect, it } from "vitest";
import { consensusOf, parseSnapshot, patchSnapshot, snapshotFrom } from "./marketSnapshot";
import { normalizeEvent } from "@/lib/providers/live/theOddsApi";
import ev from "@/lib/providers/live/__fixtures__/nfl-event-ten-bookmakers.json";

const metcalf = () =>
  normalizeEvent(ev as never, "americanfootball_nfl", "NFL").find(
    (p) => p.playerName === "DK Metcalf" && p.propType === "Receiving Yards",
  )!;

describe("market snapshot", () => {
  it("keeps every version-1 key, so old readers still work", () => {
    const snap = snapshotFrom(metcalf());
    for (const k of ["noVigProbOver", "comparableLines", "bookCount", "projection", "marketLine", "source"]) {
      expect(snap).toHaveProperty(k);
    }
    expect(snap.v).toBe(2);
  });

  it("round-trips through JSON and recomputes the same consensus from its quotes", () => {
    const json = JSON.stringify(snapshotFrom(metcalf()));
    const parsed = parseSnapshot(json)!;
    const c = consensusOf(parsed)!;
    expect(c.mean).toBeCloseTo(parsed.consensus!.mean, 9);
    expect(parsed.venues).toEqual({ underdog: 44.5, prizepicks: 41.5 });
  });

  it("reads a version-1 row without a consensus", () => {
    const old = JSON.stringify({ noVigProbOver: 0.52, marketLine: 44.5, source: "The Odds API" });
    const parsed = parseSnapshot(old)!;
    expect(parsed.v).toBe(1);
    expect(consensusOf(parsed)).toBeNull();
  });

  it("patches a field without losing the rest", () => {
    const json = JSON.stringify(snapshotFrom(metcalf()));
    const patched = parseSnapshot(patchSnapshot(json, { underdogLineSource: "manual" }))!;
    expect(patched.underdogLineSource).toBe("manual");
    expect(patched.quotes!.length).toBeGreaterThan(0);
  });

  it("survives junk", () => {
    expect(parseSnapshot("not json")).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });
});
