/**
 * nflverse season data for the research jobs: weekly stats, snap counts and
 * weekly rosters, assembled for grading (gradeProps.ts). Network only, free.
 */
import zlib from "node:zlib";
import { parseCsv } from "@/lib/utils/csv";
import { parseGradingStats, parseWeeklyRoster, type Appearance, type SeasonData } from "@/lib/nfl/gradeProps";

export const BASE = "https://github.com/nflverse/nflverse-data/releases/download";

export async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return url.endsWith(".gz") ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

export async function loadSeason(season: number, playersPfrToGsis: Map<string, string>): Promise<SeasonData> {
  const [weekly, snaps, rosterCsv] = await Promise.all([
    fetchCsv(`${BASE}/stats_player/stats_player_week_${season}.csv.gz`),
    fetchCsv(`${BASE}/snap_counts/snap_counts_${season}.csv.gz`),
    fetchCsv(`${BASE}/weekly_rosters/roster_weekly_${season}.csv`),
  ]);
  const rows = parseGradingStats(weekly);
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
  return { rows, appearances, specialTeamsOnly, roster };
}
