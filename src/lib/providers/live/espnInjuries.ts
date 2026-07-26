import { LEAGUE_CONFIG, type League } from "@/lib/teamLeagues";
import { normalizeTeamName } from "@/lib/utils/teamName";

/**
 * ESPN public injuries feed (no key) for the Team Picks vertical. Returns, per
 * team, a count of players currently OUT (IL / Out — not day-to-day) plus a few
 * named notes for evidence. Cross-league: works for MLB, NFL, NBA, WNBA; other
 * leagues (soccer, college) simply return an empty map, and the scoring engine
 * discloses "injury data unavailable". Defensive — any failure returns empty.
 */

export interface TeamInjuryInfo {
  keyOut: number;
  notes: { summary: string; sourceName: string }[];
}

export type InjuryStatus = "out" | "doubtful" | "questionable" | "active";

/** One player's injury entry, for the player-props news path. */
export interface PlayerInjuryEntry {
  playerName: string;
  status: InjuryStatus;
  detail: string; // e.g. "Out — Achilles"
  teamName: string;
}

interface EspnInjuryItem {
  status?: { name?: string };
  type?: { description?: string; abbreviation?: string };
  details?: { type?: string; detail?: string };
  athlete?: { displayName?: string; firstName?: string; lastName?: string; position?: { abbreviation?: string; displayName?: string } };
}
interface EspnInjuryTeam {
  displayName?: string;
  injuries?: EspnInjuryItem[];
}
interface EspnInjuriesResponse {
  injuries?: EspnInjuryTeam[];
}

async function fetchJson<T>(url: string, timeoutMs = 7000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Map an ESPN injury item's raw status text to our status enum (exported for tests). */
export function mapInjuryStatus(raw: {
  statusName?: string;
  typeDescription?: string;
  typeAbbreviation?: string;
}): InjuryStatus {
  const status = (raw.statusName ?? "").toLowerCase();
  const desc = (raw.typeDescription ?? "").toLowerCase();
  const abbr = (raw.typeAbbreviation ?? "").toLowerCase();
  if (status.includes("day-to-day") || status.includes("questionable") || status.includes("gtd")) {
    return "questionable";
  }
  if (status.includes("probable") || status.includes("active")) return "active";
  if (status.includes("doubtful") || abbr === "d") return "doubtful";
  if (
    status.includes("out") ||
    status.includes("injured") ||
    status.includes("suspension") ||
    desc.includes("il") ||
    desc.includes("out") ||
    abbr.startsWith("il") ||
    abbr === "o"
  ) {
    return "out";
  }
  return "questionable";
}

function statusOf(it: EspnInjuryItem): InjuryStatus {
  return mapInjuryStatus({
    statusName: it.status?.name,
    typeDescription: it.type?.description,
    typeAbbreviation: it.type?.abbreviation,
  });
}

/** A player counts toward a team's "key out" tally when out or doubtful. */
function isOut(it: EspnInjuryItem): boolean {
  const s = statusOf(it);
  return s === "out" || s === "doubtful";
}

function playerName(it: EspnInjuryItem): string {
  const a = it.athlete;
  if (!a) return "A player";
  return a.displayName ?? [a.firstName, a.lastName].filter(Boolean).join(" ") ?? "A player";
}

function noteSummary(it: EspnInjuryItem): string {
  const pos = it.athlete?.position?.abbreviation ?? it.athlete?.position?.displayName;
  const label = it.type?.description ?? it.status?.name ?? "out";
  return `${playerName(it)}${pos ? ` (${pos})` : ""} — ${label}`;
}

const rawCache = new Map<string, { at: number; teams: EspnInjuryTeam[] }>();
const TTL = 30 * 60 * 1000;

/** Fetch the league-wide injury feed once (cached), shared by both views below. */
async function fetchRawInjuries(espnSport: string, espnLeague: string): Promise<EspnInjuryTeam[]> {
  const cacheKey = `${espnSport}/${espnLeague}`;
  const cached = rawCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL) return cached.teams;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/injuries`;
  const data = await fetchJson<EspnInjuriesResponse>(url);
  const teams = data?.injuries ?? [];
  rawCache.set(cacheKey, { at: Date.now(), teams });
  return teams;
}

/** Team-vertical view: OUT counts + notes keyed by normalized team name. */
export async function fetchInjuries(league: League): Promise<Map<string, TeamInjuryInfo>> {
  const cfg = LEAGUE_CONFIG[league];
  const teams = await fetchRawInjuries(cfg.espnSport, cfg.espnLeague);
  const map = new Map<string, TeamInjuryInfo>();
  for (const team of teams) {
    const name = team.displayName;
    if (!name) continue;
    const out = (team.injuries ?? []).filter(isOut);
    map.set(normalizeTeamName(name), {
      keyOut: out.length,
      notes: out.slice(0, 4).map((it) => ({ summary: noteSummary(it), sourceName: "ESPN" })),
    });
  }
  return map;
}

/** Player-props view: flat list of injured players (out/doubtful/questionable). */
export async function fetchLeagueInjuries(espnSport: string, espnLeague: string): Promise<PlayerInjuryEntry[]> {
  const teams = await fetchRawInjuries(espnSport, espnLeague);
  const out: PlayerInjuryEntry[] = [];
  for (const team of teams) {
    for (const it of team.injuries ?? []) {
      const name = playerName(it);
      if (name === "A player") continue;
      out.push({
        playerName: name,
        status: statusOf(it),
        detail: noteSummary(it),
        teamName: team.displayName ?? "",
      });
    }
  }
  return out;
}
