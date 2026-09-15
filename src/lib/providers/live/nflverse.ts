import "server-only";
import zlib from "node:zlib";
import { parseCsv } from "@/lib/utils/csv";
import { cacheGet, cacheSet } from "@/lib/providerCache";

/**
 * nflverse (https://github.com/nflverse/nflverse-data) — free, no key, no rate
 * limit. Publishes per-game snap counts and weekly player stats as gzipped CSV
 * on GitHub releases, refreshed within hours of each game.
 *
 * This is where snap share and target share come from: the two most predictive
 * NFL prop inputs, and the two the ESPN gamelog cannot give us. A raw target
 * count conflates role with game script — a receiver who played 90% of snaps and
 * saw three looks reads identically to one who played 30%. Share separates them.
 *
 * Joining is by id, never by name: nflverse ships `espn_id` in players.csv, and
 * we already resolve every prop to an ESPN athlete, so the link is exact.
 */

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";

const IDMAP_KEY = "nflverse:idmap:v1";
const WEEKLY_KEY = (season: number) => `nflverse:weekly:${season}`;
const SNAPS_KEY = (season: number) => `nflverse:snaps:${season}`;

const IDMAP_TTL = 7 * 24 * 60 * 60 * 1000; // rosters change slowly
const STATS_TTL = 6 * 60 * 60 * 1000; // republished within hours of a game

/** Skill positions are the only ones with player props worth modelling. */
const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE", "FB"]);

async function fetchCsv(url: string, timeoutMs = 20000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // GitHub serves these pre-gzipped; `fetch` does not transparently decode a
    // .gz *file* (as opposed to a gzip transfer-encoding), so unzip it ourselves.
    return url.endsWith(".gz") ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- id map -------------------------------------------------------------

export interface NflverseIds {
  espnId: string;
  gsisId: string;
  pfrId: string;
  name: string;
  position: string;
}

/** Slim players.csv (7MB) down to the skill players we might ever price. */
export function buildIdMap(csv: string, minLastSeason: number): NflverseIds[] {
  const { rows } = parseCsv(csv);
  const out: NflverseIds[] = [];
  for (const r of rows) {
    const espnId = r.espn_id;
    const gsisId = r.gsis_id;
    if (!espnId || !gsisId) continue;
    const position = (r.position || r.position_group || "").toUpperCase();
    if (!SKILL_POSITIONS.has(position)) continue;
    const last = Number(r.last_season);
    if (Number.isFinite(last) && last < minLastSeason) continue;
    out.push({ espnId, gsisId, pfrId: r.pfr_id ?? "", name: r.display_name ?? "", position });
  }
  return out;
}

export async function getIdMap(season: number): Promise<Map<string, NflverseIds>> {
  const hit = await cacheGet<NflverseIds[]>(IDMAP_KEY, IDMAP_TTL);
  if (hit) return new Map(hit.value.map((r) => [r.espnId, r]));
  const csv = await fetchCsv(`${BASE}/players/players.csv`);
  if (!csv) {
    const stale = await cacheGet<NflverseIds[]>(IDMAP_KEY);
    return new Map((stale?.value ?? []).map((r) => [r.espnId, r]));
  }
  const rows = buildIdMap(csv, season - 1);
  await cacheSet(IDMAP_KEY, rows);
  return new Map(rows.map((r) => [r.espnId, r]));
}

// ---- weekly stats & snap counts ----------------------------------------

export interface WeeklyStatRow {
  gsisId: string;
  week: number;
  team: string;
  opponent: string;
  position: string;
  targets: number | null;
  targetShare: number | null;
  airYardsShare: number | null;
  receptions: number | null;
  receivingYards: number | null;
  carries: number | null;
}

const num = (v: string | undefined): number | null => {
  if (v == null || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseWeeklyStats(csv: string): WeeklyStatRow[] {
  const { rows } = parseCsv(csv);
  const out: WeeklyStatRow[] = [];
  for (const r of rows) {
    if (r.season_type && r.season_type !== "REG" && r.season_type !== "POST") continue;
    const gsisId = r.player_id;
    const week = num(r.week);
    if (!gsisId || week == null) continue;
    out.push({
      gsisId,
      week,
      team: r.team ?? r.recent_team ?? "",
      opponent: r.opponent_team ?? "",
      position: (r.position || "").toUpperCase(),
      targets: num(r.targets),
      targetShare: num(r.target_share),
      airYardsShare: num(r.air_yards_share),
      receptions: num(r.receptions),
      receivingYards: num(r.receiving_yards),
      carries: num(r.carries),
    });
  }
  return out;
}

export interface SnapRow {
  pfrId: string;
  week: number;
  team: string;
  position: string;
  offensePct: number | null;
  offenseSnaps: number | null;
}

export function parseSnapCounts(csv: string): SnapRow[] {
  const { rows } = parseCsv(csv);
  const out: SnapRow[] = [];
  for (const r of rows) {
    const pfrId = r.pfr_player_id;
    const week = num(r.week);
    if (!pfrId || week == null) continue;
    const position = (r.position || "").toUpperCase();
    if (!SKILL_POSITIONS.has(position)) continue;
    out.push({
      pfrId,
      week,
      team: r.team ?? "",
      position,
      // nflverse reports offense_pct as a 0..1 fraction.
      offensePct: num(r.offense_pct),
      offenseSnaps: num(r.offense_snaps),
    });
  }
  return out;
}

export async function getWeeklyStats(season: number): Promise<WeeklyStatRow[]> {
  const hit = await cacheGet<WeeklyStatRow[]>(WEEKLY_KEY(season), STATS_TTL);
  if (hit) return hit.value;
  const csv = await fetchCsv(`${BASE}/stats_player/stats_player_week_${season}.csv.gz`);
  if (!csv) return (await cacheGet<WeeklyStatRow[]>(WEEKLY_KEY(season)))?.value ?? [];
  const rows = parseWeeklyStats(csv);
  await cacheSet(WEEKLY_KEY(season), rows);
  return rows;
}

export async function getSnapCounts(season: number): Promise<SnapRow[]> {
  const hit = await cacheGet<SnapRow[]>(SNAPS_KEY(season), STATS_TTL);
  if (hit) return hit.value;
  const csv = await fetchCsv(`${BASE}/snap_counts/snap_counts_${season}.csv.gz`);
  if (!csv) return (await cacheGet<SnapRow[]>(SNAPS_KEY(season)))?.value ?? [];
  const rows = parseSnapCounts(csv);
  await cacheSet(SNAPS_KEY(season), rows);
  return rows;
}

export interface NflverseRefreshSummary {
  season: number;
  idMapPlayers: number;
  weeklyRows: number;
  snapRows: number;
  latestWeek: number | null;
}

/** Warm every nflverse dataset for a season. Free; no API credits. */
export async function refreshNflverse(season: number): Promise<NflverseRefreshSummary> {
  const [idMap, weekly, snaps] = await Promise.all([
    getIdMap(season),
    getWeeklyStats(season),
    getSnapCounts(season),
  ]);
  const weeks = weekly.map((w) => w.week).filter((w) => Number.isFinite(w));
  return {
    season,
    idMapPlayers: idMap.size,
    weeklyRows: weekly.length,
    snapRows: snaps.length,
    latestWeek: weeks.length ? Math.max(...weeks) : null,
  };
}
