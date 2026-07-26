import type { MatchupContext, ScorablePropInput } from "@/types";
import { espnPathForSport } from "./espn";
import { resolveEspnAthlete } from "./espnPlayerStats";
import { normalizeTeamName, lookupTeam } from "@/lib/utils/teamName";

/**
 * Opponent-defense ranking from ESPN standings (free, no key). v1 uses only the
 * verified points/goals-allowed family: basketball Points & Pts+Reb+Ast, NHL
 * Goals & Points. Everything else returns undefined (the scorer's missing-data
 * path handles it honestly — we never set `opponentAllowedAverage`, which the
 * engine would compare directly to a player line of a different scale).
 */

const SUPPORTED: Record<string, Set<string>> = {
  basketball: new Set(["Points", "Pts+Reb+Ast"]),
  hockey: new Set(["Goals", "Points"]),
};

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

interface StandingEntry {
  team?: { displayName?: string; name?: string };
  stats?: { name?: string; value?: number | string }[];
}

/** Rank teams by points/goals allowed per game — rank 1 = fewest allowed = toughest (pure, tested). */
export function buildDefenseRanks(
  entries: StandingEntry[],
  family: string,
): Map<string, { paPerGame: number; rank: number }> {
  const rows: { name: string; paPerGame: number }[] = [];
  for (const e of entries) {
    const name = e.team?.displayName ?? e.team?.name;
    if (!name) continue;
    const stat = (n: string) => e.stats?.find((s) => s.name === n)?.value;
    let pa: number | undefined;
    if (family === "basketball") {
      pa = num(stat("avgPointsAgainst"));
    } else if (family === "hockey") {
      const against = num(stat("pointsAgainst"));
      const gp = num(stat("gamesPlayed"));
      pa = against != null && gp ? against / gp : undefined;
    }
    if (pa != null) rows.push({ name: normalizeTeamName(name), paPerGame: pa });
  }
  rows.sort((a, b) => a.paPerGame - b.paPerGame);
  const map = new Map<string, { paPerGame: number; rank: number }>();
  rows.forEach((r, i) => map.set(r.name, { paPerGame: r.paPerGame, rank: i + 1 }));
  return map;
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface StandingsJson {
  standings?: { entries?: StandingEntry[] };
  children?: { standings?: { entries?: StandingEntry[] } }[];
}

const cache = new Map<string, { at: number; ranks: Map<string, { paPerGame: number; rank: number }> }>();
const DAY = 24 * 60 * 60 * 1000;

async function getDefenseRanks(family: { sport: string; league: string }): Promise<Map<string, { paPerGame: number; rank: number }>> {
  const key = `${family.sport}/${family.league}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < DAY) return cached.ranks;
  const data = await fetchJson<StandingsJson>(`https://site.api.espn.com/apis/v2/sports/${family.sport}/${family.league}/standings`);
  const entries: StandingEntry[] = [
    ...(data?.standings?.entries ?? []),
    ...(data?.children ?? []).flatMap((c) => c.standings?.entries ?? []),
  ];
  const ranks = buildDefenseRanks(entries, family.sport);
  cache.set(key, { at: Date.now(), ranks });
  return ranks;
}

export async function getEspnMatchup(prop: ScorablePropInput): Promise<MatchupContext | undefined> {
  if (prop.sport === "MLB" || prop.sport === "Soccer") return undefined;
  const family = espnPathForSport(prop.sport);
  if (!family || !SUPPORTED[family.sport]?.has(prop.propType)) return undefined;

  const ranks = await getDefenseRanks(family);
  if (ranks.size === 0) return undefined;

  const ref = await resolveEspnAthlete(prop.sport, prop.playerName, prop.team, prop.opponent).catch(() => null);
  if (!ref) return undefined; // can't tell which team is the opponent → don't guess polarity
  const opponentName = ref.teamName === prop.team ? prop.opponent : prop.team;
  const opp = lookupTeam(ranks, opponentName);
  if (!opp) return undefined;

  const unit = family.sport === "hockey" ? "goals" : "pts";
  return {
    opponentDefenseRank: opp.rank,
    leagueSize: ranks.size,
    opponentContext: `${opponentName} allow ${opp.paPerGame.toFixed(1)} ${unit}/game (rank ${opp.rank}/${ranks.size})`,
    source: "ESPN standings",
  };
}
