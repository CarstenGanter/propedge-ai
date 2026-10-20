import { describe, expect, it } from "vitest";
import { nflWeekKey, overGapStatus, type SkillItem } from "./marketSkill";
import { overStatusLine } from "@/lib/weeklySummary";

const SUNDAYS = ["2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];

/** A week of 8 games × 10 props at a 50% books' price, `overs` of each game's 10 landing Over. */
function week(date: string, overs: number): SkillItem[] {
  const out: SkillItem[] = [];
  for (let g = 0; g < 8; g++) {
    for (let k = 0; k < 10; k++) out.push({ pModel: 0.5, pMarket: 0.5, over: k < overs, cluster: `${date}|g${g}`, propType: "Receiving Yards", date });
  }
  return out;
}
const opts = { reps: 200 };

describe("nflWeekKey", () => {
  it("keys Thursday through Tuesday by the Wednesday that opens the week", () => {
    expect(nflWeekKey("2026-10-15")).toBe("2026-10-14"); // Thu
    expect(nflWeekKey("2026-10-18")).toBe("2026-10-14"); // Sun
    expect(nflWeekKey("2026-10-19")).toBe("2026-10-14"); // Mon
    expect(nflWeekKey("2026-10-21")).toBe("2026-10-21"); // Wed opens the next
  });
});

describe("overGapStatus", () => {
  it("stays unflagged while no cumulative interval excludes zero", () => {
    expect(overGapStatus([...week(SUNDAYS[0], 5), ...week(SUNDAYS[1], 5)], opts).state).toBe("none");
  });

  it("flags the first week whose data through that week excludes zero, never looking ahead", () => {
    const s = overGapStatus([...week(SUNDAYS[0], 5), ...week(SUNDAYS[1], 2), ...week(SUNDAYS[2], 2)], opts);
    expect(s).toMatchObject({ state: "flagged", crossedWeek: nflWeekKey(SUNDAYS[1]), direction: "below", weeksAfter: 1 });
  });

  it("needs at least four later weeks before it can confirm", () => {
    const three = [SUNDAYS[0], SUNDAYS[1], SUNDAYS[2], SUNDAYS[3]].flatMap((d) => week(d, 2));
    expect(overGapStatus(three, opts)).toMatchObject({ state: "flagged", weeksAfter: 3 });
    const four = [...three, ...week(SUNDAYS[4], 2)];
    expect(overGapStatus(four, opts)).toMatchObject({ state: "confirmed", crossedWeek: nflWeekKey(SUNDAYS[0]), weeksAfter: 4 });
  });

  it("confirms only on the weeks after the crossing: a gap that vanishes later stays flagged", () => {
    const items = [...week(SUNDAYS[0], 2), ...[1, 2, 3, 4, 5].flatMap((i) => week(SUNDAYS[i], 5))];
    const s = overGapStatus(items, opts);
    expect(s).toMatchObject({ state: "flagged", weeksAfter: 5 });
    expect(s.after?.gapPts).toBeCloseTo(0);
  });

  it("requires the later weeks to exclude zero on the same side", () => {
    const items = [...week(SUNDAYS[0], 2), ...[1, 2, 3, 4].flatMap((i) => week(SUNDAYS[i], 8))];
    expect(overGapStatus(items, opts)).toMatchObject({ state: "flagged", direction: "below" });
  });

  it("reads as one line in the weekly summary", () => {
    expect(overStatusLine(overGapStatus(week(SUNDAYS[0], 5), opts))).toMatch(/^no flag/);
    expect(overStatusLine(overGapStatus([...week(SUNDAYS[0], 2), ...week(SUNDAYS[1], 2)], opts))).toMatch(/^FLAGGED — Over below the books, first crossed week of 2026-09-09; 1 of 4 later weeks/);
  });
});
