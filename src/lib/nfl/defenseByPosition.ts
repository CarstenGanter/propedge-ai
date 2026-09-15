import type { WeeklyStatRow } from "@/lib/providers/live/nflverse";

/**
 * What each defense gives up **by position group** (pure, tested).
 *
 * Team totals cannot express the difference that matters most for a prop: a
 * defense can smother outside receivers and be shredded by tight ends. Scoring
 * a tight end's receiving prop against a team's total passing yards allowed
 * mixes those together. Every row here is one player-game from nflverse, keyed
 * by `opponent_team` — the defense that allowed it.
 */

export type PosGroup = "WR" | "TE" | "RB";

/** nflverse positions folded into the three groups that catch passes. */
export function posGroupOf(position: string): PosGroup | null {
  const p = position.toUpperCase();
  if (p === "WR") return "WR";
  if (p === "TE") return "TE";
  if (p === "RB" || p === "FB") return "RB";
  return null;
}

export interface PositionalAllowed {
  recYdsPg: number;
  recPg: number;
  targetsPg: number;
  rushYdsPg: number;
  gp: number;
}

export type DefenseByPosition = Map<string, Partial<Record<PosGroup, PositionalAllowed>>>;

/** Aggregate per-game production allowed by each defense to each position group. */
export function aggregateDefenseVsPosition(rows: WeeklyStatRow[]): DefenseByPosition {
  // team -> pos -> totals, plus the set of weeks that defense actually played.
  const totals = new Map<string, Map<PosGroup, { recYds: number; rec: number; targets: number; rushYds: number }>>();
  const weeksByTeam = new Map<string, Set<number>>();

  for (const r of rows) {
    const def = r.opponent;
    if (!def) continue;
    const weeks = weeksByTeam.get(def) ?? new Set<number>();
    weeks.add(r.week);
    weeksByTeam.set(def, weeks);

    const pos = posGroupOf(r.position);
    if (!pos) continue;
    const byPos = totals.get(def) ?? new Map();
    const t = byPos.get(pos) ?? { recYds: 0, rec: 0, targets: 0, rushYds: 0 };
    t.recYds += r.receivingYards ?? 0;
    t.rec += r.receptions ?? 0;
    t.targets += r.targets ?? 0;
    t.rushYds += r.rushingYards ?? 0;
    byPos.set(pos, t);
    totals.set(def, byPos);
  }

  const out: DefenseByPosition = new Map();
  for (const [team, byPos] of totals) {
    const gp = weeksByTeam.get(team)?.size ?? 0;
    if (gp === 0) continue;
    const entry: Partial<Record<PosGroup, PositionalAllowed>> = {};
    for (const [pos, t] of byPos) {
      entry[pos] = {
        recYdsPg: round1(t.recYds / gp),
        recPg: round1(t.rec / gp),
        targetsPg: round1(t.targets / gp),
        rushYdsPg: round1(t.rushYds / gp),
        gp,
      };
    }
    out.set(team, entry);
  }
  return out;
}

export type PositionalMetric = "recYdsPg" | "recPg" | "rushYdsPg";

export interface PositionalRank {
  team: string;
  allowedPg: number;
  rank: number; // 1 = fewest allowed = toughest
  leagueSize: number;
  gp: number;
}

/** Rank defenses by what they allow to one position group. */
export function rankDefenseVsPosition(
  agg: DefenseByPosition,
  pos: PosGroup,
  metric: PositionalMetric,
): Map<string, PositionalRank> {
  const rows: { team: string; allowedPg: number; gp: number }[] = [];
  for (const [team, byPos] of agg) {
    const entry = byPos[pos];
    if (!entry) continue;
    rows.push({ team, allowedPg: entry[metric], gp: entry.gp });
  }
  rows.sort((a, b) => a.allowedPg - b.allowedPg || a.team.localeCompare(b.team));
  const out = new Map<string, PositionalRank>();
  rows.forEach((r, i) =>
    out.set(r.team, { team: r.team, allowedPg: r.allowedPg, rank: i + 1, leagueSize: rows.length, gp: r.gp }),
  );
  return out;
}

/** Which position group and metric a prop should be measured against. */
export function metricForProp(propType: string): PositionalMetric | null {
  switch (propType) {
    case "Receiving Yards":
      return "recYdsPg";
    case "Receptions":
      return "recPg";
    case "Rushing Yards":
    case "Rush Attempts":
      return "rushYdsPg";
    default:
      return null; // passing props belong to the team-level view
  }
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
