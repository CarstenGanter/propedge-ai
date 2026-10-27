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
 *
 * Players are matched by id: the prop's ESPN athlete id, found in that week's
 * nflverse roster, gives the gsis id every stat and snap row is keyed by — and
 * the team he was on that week, so a mid-season trade grades against the
 * right game. A name match against that week's rosters is the fallback for a
 * prop with no ESPN id.
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
  /** nflverse weekly rosters: who was on which team, with which status, each week. */
  roster?: RosterEntry[];
  /** nflverse schedule: which week each game was, by date and ESPN game id. */
  schedule?: ScheduledGame[];
}

export interface ScheduledGame {
  week: number;
  /** "YYYY-MM-DD", the game's local date as nflverse lists it. */
  gameday: string;
  home: string;
  away: string;
  espnGameId: string | null;
}

/** nflverse schedules games.csv → one season's games. */
export function parseSchedule(csv: string, season: number): ScheduledGame[] {
  const out: ScheduledGame[] = [];
  for (const r of parseCsv(csv).rows) {
    if (Number(r.season) !== season) continue;
    const week = Number(r.week);
    if (!Number.isFinite(week) || !r.gameday) continue;
    out.push({ week, gameday: r.gameday, home: r.home_team ?? "", away: r.away_team ?? "", espnGameId: r.espn || null });
  }
  return out;
}

/**
 * The week of one game from the schedule: by ESPN game id when the prop has
 * one, otherwise the two teams (either side at home — a neutral-site game may
 * list them the other way) within a day of the slate date. Null when it can't
 * be told. Stat rows can't answer this: they carry the player's team and
 * opponent but no date and no home side, so the second meeting of division
 * rivals looks exactly like the first.
 */
export function weekForScheduledGame(
  schedule: ScheduledGame[],
  game: { home: string; away: string; date?: string; espnGameId?: string | null },
): number | null {
  if (game.espnGameId) {
    const byId = schedule.find((s) => s.espnGameId === game.espnGameId);
    if (byId) return byId.week;
  }
  if (!game.date) return null;
  const day = Date.parse(`${game.date}T12:00:00Z`);
  const near = schedule.filter(
    (s) =>
      ((s.home === game.home && s.away === game.away) || (s.home === game.away && s.away === game.home)) &&
      Math.abs(Date.parse(`${s.gameday}T12:00:00Z`) - day) <= 86_400_000,
  );
  return near.length === 1 ? near[0].week : null;
}

export interface RosterEntry {
  gsisId: string;
  espnId: string | null;
  week: number;
  team: string;
  /** ACT, INA (inactive), RES (reserve/injured), … */
  status: string;
  /** WR, TE, RB (FB folded in), QB, … */
  position?: string;
  name: string;
  /** "football name" + last name, e.g. "D.J. Moore" for full name "Denniston Moore". */
  altName?: string;
}

/** nflverse roster_weekly CSV → entries. */
export function parseWeeklyRoster(csv: string): RosterEntry[] {
  const { rows } = parseCsv(csv);
  const out: RosterEntry[] = [];
  for (const r of rows) {
    const week = Number(r.week);
    if (!r.gsis_id || !Number.isFinite(week)) continue;
    out.push({
      gsisId: r.gsis_id,
      espnId: r.espn_id || null,
      week,
      team: r.team ?? "",
      status: r.status ?? "",
      position: r.position === "FB" ? "RB" : r.position || undefined,
      name: r.full_name ?? "",
      altName: r.football_name && r.last_name ? `${r.football_name} ${r.last_name}` : undefined,
    });
  }
  return out;
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

/** Every week in which these two teams met, from the stat rows (which can't say who was at home). */
export function weeksForPair(rows: StatRow[], home: string, away: string): number[] {
  const weeks = new Set<number>();
  for (const r of rows) if ((r.team === home && r.opponent === away) || (r.team === away && r.opponent === home)) weeks.add(r.week);
  return [...weeks].sort((a, b) => a - b);
}

/**
 * The week of a game from stat rows alone, only when the two teams met once.
 * A rematch (division rivals meet twice) is ambiguous here: use the schedule.
 */
export function weekForGame(rows: StatRow[], home: string, away: string): number | null {
  const weeks = weeksForPair(rows, home, away);
  return weeks.length === 1 ? weeks[0] : null;
}

export type Grade =
  | { kind: "graded"; value: number; gsisId: string; week: number; fromSnapsOnly: boolean; matchedBy: MatchedBy }
  | { kind: "void"; gsisId: string; week: number; reason: string; matchedBy: MatchedBy }
  | { kind: "unmatched"; week: number; reason: string }
  | { kind: "pending" };

export type MatchedBy = "id" | "name" | "alias";

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

/**
 * Two players of one name in the same game (on 2026-10-18 the Eagles' DeVonta
 * Smith and a Panthers practice-squad Devonta Smith) resolve to the one who
 * played that week; if both or neither played, the match stays ambiguous.
 */
function pick(ids: string[], played: Set<string>): string | null {
  if (ids.length === 1) return ids[0];
  const active = ids.filter((id) => played.has(id));
  return active.length === 1 ? active[0] : null;
}

function matchPlayer(playerName: string, candidates: Candidate[], played: Set<string> = new Set()): string | null {
  const target = baseName(playerName);
  const exact = [...new Set(candidates.filter((c) => baseName(c.name) === target).map((c) => c.gsisId))];
  if (exact.length > 0) return pick(exact, played);
  const loose = [...new Set(candidates.filter((c) => nameMatch(baseName(c.name), target)).map((c) => c.gsisId))];
  return loose.length > 0 ? pick(loose, played) : null;
}

/**
 * Grade one prop. The game's week comes from the schedule (by ESPN game id,
 * else teams and date) when the season data has one; stat rows alone can
 * only place a game the two teams played once. The player is matched by ESPN
 * id when the prop has one and that week's roster knows it; otherwise by name
 * among the two teams' players that week, so a common surname elsewhere in
 * the league cannot collide. Pending means the game is not in the data yet.
 * With `alias` (research grading passes aliasFor from playerAliases.ts), a
 * name that matches no one is tried once more under its alias before it is
 * declared unmatched; settlement passes none.
 */
export function gradeProp(
  prop: { playerName: string; espnId?: string | null; propType: string; home: string; away: string; date?: string; espnGameId?: string | null },
  season: SeasonData,
  opts: { alias?: (feedName: string) => string | null } = {},
): Grade {
  const teams = new Set([prop.home, prop.away]);
  let week: number | null;
  if (season.schedule && (prop.espnGameId || prop.date)) {
    week = weekForScheduledGame(season.schedule, prop);
    if (week == null) return { kind: "unmatched", week: 0, reason: "game not found in the nflverse schedule" };
    if (!season.rows.some((r) => r.week === week && teams.has(r.team))) return { kind: "pending" };
  } else {
    const weeks = weeksForPair(season.rows, prop.home, prop.away);
    if (weeks.length === 0) return { kind: "pending" };
    if (weeks.length > 1) return { kind: "unmatched", week: 0, reason: `the teams met in weeks ${weeks.join(" and ")}; needs the schedule to tell which` };
    week = weeks[0];
  }
  const rows = season.rows.filter((r) => r.week === week && teams.has(r.team));
  const apps = season.appearances.filter((a) => a.week === week && teams.has(a.team));
  const stOnly = (season.specialTeamsOnly ?? []).filter((a) => a.week === week && teams.has(a.team));
  const weekRoster = (season.roster ?? []).filter((r) => r.week === week);

  let gsisId: string | null = null;
  let matchedBy: MatchedBy = "name";
  if (prop.espnId) {
    const entry = weekRoster.find((r) => r.espnId === prop.espnId);
    if (entry && !teams.has(entry.team)) return { kind: "unmatched", week, reason: `id is on ${entry.team} that week` };
    if (entry) {
      gsisId = entry.gsisId;
      matchedBy = "id";
    }
  }
  if (!gsisId) {
    const rosterNames = weekRoster
      .filter((r) => teams.has(r.team))
      .flatMap((r) => [{ gsisId: r.gsisId, name: r.name }, ...(r.altName ? [{ gsisId: r.gsisId, name: r.altName }] : [])]);
    const played = new Set([...rows.map((r) => r.gsisId), ...apps.map((a) => a.gsisId)]);
    const candidates = [...rows, ...apps, ...stOnly, ...rosterNames];
    gsisId = matchPlayer(prop.playerName, candidates, played);
    const alias = gsisId ? null : opts.alias?.(prop.playerName);
    if (alias) {
      gsisId = matchPlayer(alias, candidates, played);
      if (gsisId) matchedBy = "alias";
    }
  }
  if (!gsisId) return { kind: "unmatched", week, reason: "no player of that name on either team that week" };

  const row = rows.find((r) => r.gsisId === gsisId);
  if (row) {
    const value = statValue(row, prop.propType);
    return value == null
      ? { kind: "unmatched", week, reason: `nflverse cannot grade ${prop.propType}` }
      : { kind: "graded", value, gsisId, week, fromSnapsOnly: false, matchedBy };
  }
  if (apps.some((a) => a.gsisId === gsisId)) return { kind: "graded", value: 0, gsisId, week, fromSnapsOnly: true, matchedBy };
  if (stOnly.some((a) => a.gsisId === gsisId)) return { kind: "void", gsisId, week, reason: "special teams only", matchedBy };
  const status = weekRoster.find((r) => r.gsisId === gsisId)?.status;
  return { kind: "void", gsisId, week, reason: `did not play${status ? ` (roster status ${status})` : ""}`, matchedBy };
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
