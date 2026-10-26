/**
 * Which alternate ladders a slate fetch buys (pure). November 2026 budget,
 * approved 2026-10-26: rushing yards on two Sundays (~1 credit a game), the
 * next prop type for the consensus-spread fit. The second runs only if
 * month-to-date spend through Nov 15 is no more than 20 over the plan
 * through Nov 15 (docs/ROADMAP.md).
 */
export const RUSH_LADDERS = {
  propTypes: ["Rushing Yards"],
  first: "2026-11-01",
  second: "2026-11-22",
  /** The second Sunday is judged on spend through this slate... */
  checkThrough: "2026-11-15",
  /** ...and dropped when that is more than this many credits over plan. */
  maxOverPlan: 20,
} as const;

/**
 * `driftAtCheck`: spend minus plan through RUSH_LADDERS.checkThrough, needed
 * only for the second Sunday (and an error to leave out there).
 */
export function ladderPropTypesFor(date: string, driftAtCheck: number | null): { propTypes: string[]; note?: string } {
  if (date === RUSH_LADDERS.first) return { propTypes: [...RUSH_LADDERS.propTypes] };
  if (date !== RUSH_LADDERS.second) return { propTypes: [] };
  if (driftAtCheck == null) throw new Error(`Rushing ladders on ${date} need the spend vs plan through ${RUSH_LADDERS.checkThrough}`);
  if (driftAtCheck > RUSH_LADDERS.maxOverPlan) {
    return {
      propTypes: [],
      note: `Rushing-yards ladders dropped: spend through ${RUSH_LADDERS.checkThrough} ran ${driftAtCheck} over plan (limit ${RUSH_LADDERS.maxOverPlan}).`,
    };
  }
  return { propTypes: [...RUSH_LADDERS.propTypes] };
}
