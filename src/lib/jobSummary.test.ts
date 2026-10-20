import { afterEach, describe, expect, it, vi } from "vitest";
import { emitSummary, parseSummaries } from "./jobSummary";

describe("job summary lines", () => {
  afterEach(() => vi.restoreAllMocks());

  it("round-trips what a job emits, among its ordinary output", () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => void printed.push(s));
    emitSummary("sigma", { samples: [{ sample: "held-out", n: 361 }] });
    const output = ["=== PRIMARY ===", "  venue lines 361", ...printed, "done"].join("\n");
    expect(parseSummaries(output).get("sigma")).toEqual({ samples: [{ sample: "held-out", n: 361 }] });
  });

  it("skips malformed lines and lets a later line of the same name win", () => {
    const m = parseSummaries(["@@SUMMARY a {broken", "@@SUMMARY b 1", "@@SUMMARY b 2", "@@SUMMARY nojson"].join("\n"));
    expect(m.has("a")).toBe(false);
    expect(m.get("b")).toBe(2);
    expect(m.has("nojson")).toBe(false);
  });
});
