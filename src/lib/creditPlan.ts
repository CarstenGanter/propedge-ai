import { toNflSlateDate } from "@/lib/nfl/slate";

/**
 * The approved monthly Odds API budget (pure). Credits reset at 00:00 UTC on
 * the 1st (free plan, 500 a month), so a month's spend is what falls inside
 * [periodStart, periodEnd); within it, each call counts toward the Eastern
 * slate date it was made on — the same keying as the slates themselves.
 */
export interface CreditPlan {
  month: string;
  periodStart: Date;
  periodEnd: Date;
  allowance: number;
  slates: { date: string; credits: number }[];
}

/** Approved 2026-10-26 (docs/ROADMAP.md, "November 2026 credit budget"). */
export const NOVEMBER_2026: CreditPlan = {
  month: "2026-11",
  periodStart: new Date("2026-11-01T00:00:00Z"),
  periodEnd: new Date("2026-12-01T00:00:00Z"),
  allowance: 500,
  slates: [
    { date: "2026-11-01", credits: 70 }, // 12 games + rushing-yards ladders
    { date: "2026-11-02", credits: 9 },
    { date: "2026-11-05", credits: 9 },
    { date: "2026-11-08", credits: 58 },
    { date: "2026-11-09", credits: 9 },
    { date: "2026-11-12", credits: 9 },
    { date: "2026-11-15", credits: 54 },
    { date: "2026-11-16", credits: 9 },
    { date: "2026-11-19", credits: 9 },
    { date: "2026-11-22", credits: 65 }, // 11 games + rushing-yards ladders
    { date: "2026-11-23", credits: 9 },
    { date: "2026-11-25", credits: 9 },
    { date: "2026-11-26", credits: 20 }, // Thanksgiving, 3 games
    { date: "2026-11-27", credits: 9 },
    { date: "2026-11-29", credits: 50 },
    { date: "2026-11-30", credits: 4 }, // fetch only; its closing lines fall after the reset
  ],
};

const PLANS = [NOVEMBER_2026];

/** The plan whose month holds this slate date, if one was approved. */
export function planFor(date: string): CreditPlan | null {
  return PLANS.find((p) => date.startsWith(p.month)) ?? null;
}

/** Planned credits for every slate up to and including `date`. */
export function planThrough(plan: CreditPlan, date: string): number {
  return plan.slates.filter((s) => s.date <= date).reduce((sum, s) => sum + s.credits, 0);
}

/** Month-to-date spend through a slate date against the plan through it; drift > 0 is over plan. */
export function spendVsPlan(
  plan: CreditPlan,
  spends: { at: Date; credits: number | null }[],
  date: string,
): { spent: number; plan: number; drift: number; unknownCost: number } {
  const inMonth = spends.filter(
    (s) => s.at >= plan.periodStart && s.at < plan.periodEnd && toNflSlateDate(s.at.toISOString()) <= date,
  );
  const spent = inMonth.reduce((sum, s) => sum + (s.credits ?? 0), 0);
  const planned = planThrough(plan, date);
  return { spent, plan: planned, drift: spent - planned, unknownCost: inMonth.filter((s) => s.credits == null).length };
}
