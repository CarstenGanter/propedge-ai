/**
 * nflverse season data: weekly stats, snap counts and weekly rosters,
 * assembled for grading (gradeProps.ts) by the research jobs and settlement's
 * snap-count fallback. Network only, free.
 */
import zlib from "node:zlib";
import { parseCsv } from "@/lib/utils/csv";
import { parseGradingStats, parseSchedule, parseWeeklyRoster, type Appearance, type ScheduledGame, type SeasonData, type StatRow } from "@/lib/nfl/gradeProps";

export const BASE = "https://github.com/nflverse/nflverse-data/releases/download";

export async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return url.endsWith(".gz") ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

/** Weekly stats alone (~0.4 MB): enough to tell whether a game is posted yet. */
export async function loadSeasonStats(season: number): Promise<StatRow[]> {
  return parseGradingStats(await fetchCsv(`${BASE}/stats_player/stats_player_week_${season}.csv.gz`));
}

/** One season's schedule: the week of every game, by date and ESPN game id (~2 MB, all seasons). */
export async function loadSchedule(season: number): Promise<ScheduledGame[]> {
  return parseSchedule(await fetchCsv(`${BASE}/schedules/games.csv`), season);
}

/** players.csv's PFR → gsis links, the backup for snap-count rows. */
export async function loadPfrToGsis(): Promise<Map<string, string>> {
  const players = parseCsv(await fetchCsv(`${BASE}/players/players.csv`)).rows;
  return new Map(players.filter((p) => p.pfr_id && p.gsis_id).map((p) => [p.pfr_id, p.gsis_id]));
}

export async function loadSeason(
  season: number,
  playersPfrToGsis: Map<string, string>,
  preloaded: { rows?: StatRow[]; schedule?: ScheduledGame[] } = {},
): Promise<SeasonData> {
  const [rows, snaps, rosterCsv, schedule] = await Promise.all([
    preloaded.rows ?? loadSeasonStats(season),
    fetchCsv(`${BASE}/snap_counts/snap_counts_${season}.csv.gz`),
    fetchCsv(`${BASE}/weekly_rosters/roster_weekly_${season}.csv`),
    preloaded.schedule ?? loadSchedule(season),
  ]);
  const roster = parseWeeklyRoster(rosterCsv);
  // Snap counts are keyed by PFR id: the weekly roster links it to gsis, players.csv backs it up.
  const pfrToGsis = new Map(playersPfrToGsis);
  for (const r of parseCsv(rosterCsv).rows) if (r.pfr_id && r.gsis_id) pfrToGsis.set(r.pfr_id, r.gsis_id);
  // A snap-count player without a players.csv link is tied to a stat row by name and team.
  const byNameTeam = new Map(rows.map((r) => [`${r.name}|${r.team}`, r.gsisId]));
  const appearances: Appearance[] = [];
  const specialTeamsOnly: Appearance[] = [];
  for (const r of parseCsv(snaps).rows) {
    if (r.game_type && r.game_type !== "REG" && r.game_type !== "POST") continue;
    const gsisId = pfrToGsis.get(r.pfr_player_id) ?? byNameTeam.get(`${r.player}|${r.team}`) ?? `pfr:${r.pfr_player_id}`;
    const a = { gsisId, name: r.player, week: Number(r.week), team: r.team };
    // Offensive snaps only: a special-teams snap is no chance at an offensive stat.
    if (Number(r.offense_snaps) > 0) appearances.push(a);
    else if (Number(r.st_snaps) > 0) specialTeamsOnly.push(a);
  }
  return { rows, appearances, specialTeamsOnly, roster, schedule };
}
