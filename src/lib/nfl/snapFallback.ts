import { gradeProp, type SeasonData } from "./gradeProps";

/**
 * Settlement's fallback when an NFL pick's player is missing from the ESPN box
 * score (pure, tested). ESPN lists only players who recorded a stat, so a
 * receiver who played and was never targeted looks the same as one who sat
 * out. Grading's own snap-count logic (gradeProp) tells them apart: an
 * offensive snap and no stat line is 0; special teams only, or no snap at
 * all, is void. Only once nflverse has posted the game — stats and that
 * week's snap counts — otherwise wait; anything else is left for the
 * Results page.
 */
export type SnapDecision =
  | { kind: "settle"; actualResult: 0; note: string }
  | { kind: "void"; note: string }
  | { kind: "wait"; reason: string }
  | { kind: "manual"; reason: string };

export function snapFallbackDecision(
  prop: { playerName: string; espnId?: string | null; propType: string; home: string; away: string; date?: string; espnGameId?: string | null },
  season: SeasonData,
): SnapDecision {
  const g = gradeProp(prop, season);
  if (g.kind === "pending") return { kind: "wait", reason: "nflverse has not posted the game yet" };
  const teams = new Set([prop.home, prop.away]);
  const snapsPosted = [...season.appearances, ...(season.specialTeamsOnly ?? [])].some((a) => a.week === g.week && teams.has(a.team));
  if (!snapsPosted) return { kind: "wait", reason: "nflverse has not posted that week's snap counts yet" };
  if (g.kind === "unmatched") return { kind: "manual", reason: `nflverse: ${g.reason}` };
  if (g.kind === "void") return { kind: "void", note: `Void from nflverse snap counts: ${g.reason}; not in the ESPN box score.` };
  if (g.fromSnapsOnly) return { kind: "settle", actualResult: 0, note: "Graded 0 from nflverse snap counts: offensive snaps, no stat line; not in the ESPN box score." };
  // nflverse has a stat line ESPN did not show: the two sources disagree.
  return { kind: "manual", reason: `nflverse has a stat line (${g.value}) that the ESPN box score lacks` };
}
