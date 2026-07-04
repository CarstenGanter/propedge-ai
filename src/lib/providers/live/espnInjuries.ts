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

/** A player counts as "out" for IL/Out designations, not day-to-day/questionable. */
function isOut(it: EspnInjuryItem): boolean {
  const status = (it.status?.name ?? "").toLowerCase();
  const desc = (it.type?.description ?? "").toLowerCase();
  const abbr = (it.type?.abbreviation ?? "").toLowerCase();
  if (status.includes("day-to-day") || status.includes("questionable") || status.includes("probable")) {
    return false;
  }
  return (
    status.includes("out") ||
    status.includes("injured") ||
    status.includes("doubtful") ||
    status.includes("suspension") ||
    desc.includes("il") ||
    desc.includes("out") ||
    abbr.startsWith("il") ||
    abbr === "o" ||
    abbr === "d"
  );
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

const cache = new Map<string, { at: number; data: Map<string, TeamInjuryInfo> }>();
const TTL = 30 * 60 * 1000;

/** Injuries keyed by normalized team name for a league (empty if unavailable). */
export async function fetchInjuries(league: League): Promise<Map<string, TeamInjuryInfo>> {
  const cfg = LEAGUE_CONFIG[league];
  const cacheKey = `${cfg.espnSport}/${cfg.espnLeague}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL) return cached.data;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${cfg.espnSport}/${cfg.espnLeague}/injuries`;
  const data = await fetchJson<EspnInjuriesResponse>(url);

  const map = new Map<string, TeamInjuryInfo>();
  for (const team of data?.injuries ?? []) {
    const name = team.displayName;
    if (!name) continue;
    const out = (team.injuries ?? []).filter(isOut);
    map.set(normalizeTeamName(name), {
      keyOut: out.length,
      notes: out.slice(0, 4).map((it) => ({ summary: noteSummary(it), sourceName: "ESPN" })),
    });
  }
  cache.set(cacheKey, { at: Date.now(), data: map });
  return map;
}
