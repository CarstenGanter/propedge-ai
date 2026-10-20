import { parseCsv } from "@/lib/utils/csv";
import { nameMatch, normName } from "@/lib/utils/playerName";

/**
 * Grade any stored NFL prop from nflverse, not only picks (pure, tested).
 *
 * Scoring the model against the market needs an outcome for every prop the
 * books priced. ESPN box scores (what settlement uses) only list players who
 * recorded a stat, so a receiver who played and was never targeted cannot be
 * told apart from one who sat out — that left Humphrey's Lower 14.5 on
 * 2026-10-15 ungraded for days. Snap counts settle it: a player with an
 * offensive snap and no stat line finished at 0; one with neither is void.
 */

export interface StatRow {
  gsisId: string;
  name: string;
  week: number;
  /** nflverse team code (LA, WAS…). */
  team: string;
  opponent: string;
  receptions: number;
  receivingYards: number;
  rushingYards: number;
  carries: number;
  passingYards: number;
  passingTds: number;
  completions: number;
  attempts: number;
}

/** A player who took at least one offensive snap in a week. */
export interface Appearance {
  gsisId: string;
  name: string;
  week: number;
  team: string;
}

export interface SeasonData {
  rows: StatRow[];
  /** Offensive snaps only: a special-teams snap is not a chance to record an offensive stat. */
  appearances: Appearance[];
  /**
   * Dressed but played special teams only. Graded void, not 0 — the prop never
   * had a chance — and listed so such a player is still matched by name rather
   * than reported as unmatched.
   */
  specialTeamsOnly?: Appearance[];
  /**
   * The league's players with their team (nflverse players.csv). A prop whose
   * player is on one of the two teams but has no snap and no stat that week did
   * not play: void. `team` is the player's latest team, so a mid-season move
   * can still leave a prop unmatched rather than wrongly voided.
   */
  roster?: { gsisId: string; name: string; team: string }[];
}

const n0 = (v: string | undefined): number => {
  if (v == null || v === "" || v === "NA") return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** nflverse stats_player_week CSV → rows (regular season and playoffs). */
export function parseGradingStats(csv: string): StatRow[] {
  const { rows } = parseCsv(csv);
  const out: StatRow[] = [];
  for (const r of rows) {
    if (r.season_type && r.season_type !== "REG" && r.season_type !== "POST") continue;
    const week = Number(r.week);
    if (!r.player_id || !Number.isFinite(week)) continue;
    out.push({
      gsisId: r.player_id,
      name: r.player_display_name || r.player_name || "",
      week,
      team: r.team || r.recent_team || "",
      opponent: r.opponent_team || "",
      receptions: n0(r.receptions),
      receivingYards: n0(r.receiving_yards),
      rushingYards: n0(r.rushing_yards),
      carries: n0(r.carries),
      passingYards: n0(r.passing_yards),
      passingTds: n0(r.passing_tds),
      completions: n0(r.completions),
      attempts: n0(r.attempts),
    });
  }
  return out;
}

export const GRADABLE_PROPS = [
  "Receiving Yards",
  "Receptions",
  "Rushing Yards",
  "Rush+Rec Yards",
  "Passing Yards",
  "Pass TDs",
  "Completions",
  "Pass Attempts",
  "Rush Attempts",
] as const;

/** The stat a prop is graded on. Null for a prop type nflverse cannot grade. */
export function statValue(row: StatRow, propType: string): number | null {
  switch (propType) {
    case "Receiving Yards":
      return row.receivingYards;
    case "Receptions":
      return row.receptions;
    case "Rushing Yards":
      return row.rushingYards;
    case "Rush+Rec Yards":
      return row.rushingYards + row.receivingYards;
    case "Passing Yards":
      return row.passingYards;
    case "Pass TDs":
      return row.passingTds;
    case "Completions":
      return row.completions;
    case "Pass Attempts":
      return row.attempts;
    case "Rush Attempts":
      return row.carries;
    default:
      return null;
  }
}

/**
 * The week a game was played, from any stat row of the home team against the
 * away team. Home and away together identify one regular-season game: a
 * division rematch swaps them.
 */
export function weekForGame(rows: StatRow[], home: string, away: string): number | null {
  for (const r of rows) if (r.team === home && r.opponent === away) return r.week;
  return null;
}

export type Grade =
  | { kind: "graded"; value: number; gsisId: string; week: number; fromSnapsOnly: boolean }
  | { kind: "void"; gsisId: string; week: number; reason: "special teams only" | "did not play" }
  | { kind: "unmatched"; week: number }
  | { kind: "pending" };

interface Candidate {
  gsisId: string;
  name: string;
}

/**
 * A folded name without a generational suffix. The feed writes "Travis Etienne
 * Jr." where nflverse writes "Travis Etienne" (12 of 37 unmatched props on
 * 2026-10-19). Local to grading: the shared normName feeds other matching.
 */
export function baseName(name: string): string {
  return normName(name).replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
}

function matchPlayer(playerName: string, candidates: Candidate[]): string | null {
  const target = baseName(playerName);
  const exact = [...new Set(candidates.filter((c) => baseName(c.name) === target).map((c) => c.gsisId))];
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = [...new Set(candidates.filter((c) => nameMatch(baseName(c.name), target)).map((c) => c.gsisId))];
  return loose.length === 1 ? loose[0] : null;
}

/**
 * Grade one prop. The player is matched by name among the two teams' players
 * that week only, so a common surname elsewhere in the league cannot collide.
 * Pending means the game is not in the data yet.
 */
export function gradeProp(
  prop: { playerName: string; propType: string; home: string; away: string },
  season: SeasonData,
): Grade {
  const week = weekForGame(season.rows, prop.home, prop.away);
  if (week == null) return { kind: "pending" };
  const teams = new Set([prop.home, prop.away]);
  const rows = season.rows.filter((r) => r.week === week && teams.has(r.team));
  const apps = season.appearances.filter((a) => a.week === week && teams.has(a.team));
  const stOnly = (season.specialTeamsOnly ?? []).filter((a) => a.week === week && teams.has(a.team));
  const gsisId = matchPlayer(prop.playerName, [...rows, ...apps, ...stOnly]);
  if (!gsisId) {
    const rostered = matchPlayer(prop.playerName, (season.roster ?? []).filter((r) => teams.has(r.team)));
    return rostered ? { kind: "void", gsisId: rostered, week, reason: "did not play" } : { kind: "unmatched", week };
  }
  const row = rows.find((r) => r.gsisId === gsisId);
  if (row) {
    const value = statValue(row, prop.propType);
    return value == null ? { kind: "unmatched", week } : { kind: "graded", value, gsisId, week, fromSnapsOnly: false };
  }
  if (apps.some((a) => a.gsisId === gsisId)) return { kind: "graded", value: 0, gsisId, week, fromSnapsOnly: true };
  return { kind: "void", gsisId, week, reason: "special teams only" };
}

/** Games a player appeared in during a season, most recent first, with the stat (0 for a snap with no stat line). */
function seasonGames(gsisId: string, propType: string, season: SeasonData, beforeWeek: number): number[] {
  const byWeek = new Map<number, number>();
  for (const a of season.appearances) if (a.gsisId === gsisId && a.week < beforeWeek) byWeek.set(a.week, 0);
  for (const r of season.rows) {
    if (r.gsisId !== gsisId || r.week >= beforeWeek) continue;
    const v = statValue(r, propType);
    if (v != null) byWeek.set(r.week, v);
  }
  return [...byWeek.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
}

/**
 * The game log the live model would have had before kickoff — no lookahead:
 * only weeks before the game. Mirrors the ESPN path (blendGamelogs and the 15-
 * game cut in espnPlayerStats.ts): every current-season game when there are at
 * least 4, otherwise topped up with last season's most recent games to 17
 * rows; then the 15 most recent.
 */
export function priorGames(
  gsisId: string,
  propType: string,
  week: number,
  current: SeasonData,
  prior: SeasonData | null,
): number[] {
  const cur = seasonGames(gsisId, propType, current, week);
  const rows = cur.length >= 4 ? cur : [...cur, ...(prior ? seasonGames(gsisId, propType, prior, Infinity) : [])].slice(0, 17);
  return rows.slice(0, 15);
}
