import { describe, expect, it } from "vitest";
import { exactLineProbOver } from "./exactLine";
import { devig } from "./marketConsensus";

const q = (book: string, line: number, over: number | null, under: number | null) => ({ book, line, over, under });

describe("exactLineProbOver", () => {
  it("is null when no book posted the line", () => {
    expect(exactLineProbOver([q("draftkings", 44.5, -110, -110)], 45.5)).toBeNull();
  });

  it("reads one book's de-vigged price at its own line", () => {
    expect(exactLineProbOver([q("draftkings", 44.5, -120, -100), q("fanduel", 45.5, -110, -110)], 44.5)).toBeCloseTo(devig(-120, -100));
  });

  it("weights books as the consensus does, splitting a group", () => {
    // fanduel 1.5; betonlineag and lowvig share a group at 1.2 → 0.6 each.
    const quotes = [q("fanduel", 30.5, -110, -110), q("betonlineag", 30.5, -130, 110), q("lowvig", 30.5, -130, 110)];
    const p1 = devig(-110, -110);
    const p2 = devig(-130, 110);
    expect(exactLineProbOver(quotes, 30.5)).toBeCloseTo((1.5 * p1 + 1.2 * p2) / 2.7);
  });

  it("never counts a pick'em site, a one-sided quote, or juice past the limit", () => {
    const quotes = [q("underdog", 30.5, -137, -137), q("prizepicks", 30.5, -119, -119), q("bovada", 30.5, -110, null), q("draftkings", 30.5, -400, 300)];
    expect(exactLineProbOver(quotes, 30.5)).toBeNull();
  });
});
