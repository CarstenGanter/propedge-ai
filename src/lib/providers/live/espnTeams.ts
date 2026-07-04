import type { TeamSide } from "@/types";
import { LEAGUE_CONFIG, type League } from "@/lib/teamLeagues";

/**
 * ESPN public scoreboard for game-winner picks: schedules + team records (form)
 * and final winners (settlement). Defensive — failures return empty/unresolved.
 */

const COMBINING = new RegExp("[\\u0300-\\u036f]", "g");
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function teamMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
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

interface EspnCompetitor {
  homeAway?: string;
  winner?: boolean;
  team?: { displayName?: string; abbreviation?: string };
  score?: string;
  records?: { name?: string; type?: string; summary?: string }[];
}
interface EspnEvent {
  id: string;
  date?: string;
  competitions?: {
    status?: { type?: { completed?: boolean } };
    competitors?: EspnCompetitor[];
  }[];
}

export interface GameRow {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeRecord?: string;
  awayRecord?: string;
  commenceTime?: string;
  completed: boolean;
  homeWinner?: boolean;
  awayWinner?: boolean;
  homeScore?: number;
  awayScore?: number;
}

function overallRecord(c?: EspnCompetitor): string | undefined {
  return c?.records?.find((r) => r.type === "total" || r.name === "overall")?.summary ?? c?.records?.[0]?.summary;
}

export async function fetchGames(league: League, dateYYYYMMDD: string): Promise<GameRow[]> {
  const cfg = LEAGUE_CONFIG[league];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${cfg.espnSport}/${cfg.espnLeague}/scoreboard?dates=${dateYYYYMMDD}`;
  const data = await fetchJson<{ events?: EspnEvent[] }>(url);
  const events = data?.events ?? [];
  const rows: GameRow[] = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home?.team?.displayName || !away?.team?.displayName) continue;
    rows.push({
      gameId: ev.id,
      homeTeam: home.team.displayName,
      awayTeam: away.team.displayName,
      homeRecord: overallRecord(home),
      awayRecord: overallRecord(away),
      commenceTime: ev.date,
      completed: comp?.status?.type?.completed ?? false,
      homeWinner: home.winner,
      awayWinner: away.winner,
      homeScore: home.score != null ? Number(home.score) : undefined,
      awayScore: away.score != null ? Number(away.score) : undefined,
    });
  }
  return rows;
}

export interface GameResult {
  resolved: boolean;
  winner?: TeamSide;
  note?: string;
}

/** Final result for a game, as HOME/AWAY/DRAW, or unresolved. */
export async function getGameResult(
  league: League,
  dateYYYYMMDD: string,
  homeTeam: string,
  awayTeam: string,
): Promise<GameResult> {
  const games = await fetchGames(league, dateYYYYMMDD);
  const g = games.find((x) => teamMatch(x.homeTeam, homeTeam) && teamMatch(x.awayTeam, awayTeam));
  if (!g) return { resolved: false, note: "Game not found on ESPN — settle manually." };
  if (!g.completed) return { resolved: false, note: "Game not final yet." };

  if (g.homeWinner) return { resolved: true, winner: "HOME" };
  if (g.awayWinner) return { resolved: true, winner: "AWAY" };
  // Neither flagged winner on a completed game → draw (or fall back to score).
  if (g.homeScore != null && g.awayScore != null) {
    if (g.homeScore > g.awayScore) return { resolved: true, winner: "HOME" };
    if (g.awayScore > g.homeScore) return { resolved: true, winner: "AWAY" };
    return { resolved: true, winner: "DRAW" };
  }
  return { resolved: true, winner: "DRAW" };
}
