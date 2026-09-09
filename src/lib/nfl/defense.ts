import { normalizeTeamName } from "@/lib/utils/teamName";
import type { StatFamily } from "./slate";

/**
 * Opponent-defense aggregation from ESPN box scores (pure, tested). Each
 * completed game yields two "team game lines": what each team ALLOWED, taken
 * from the opponent's offensive totals. Ranks are computed per stat family
 * (rank 1 = fewest allowed per game = toughest defense).
 */

export interface TeamGameLine {
  eventId: string;
  season: number;
  week: number | null;
  team: string; // display name as ESPN reports it
  opponent: string;
  oppNetPassYds: number;
  oppRushYds: number;
  oppTotalYds: number;
  oppCompletions: number;
  oppPassTds: number;
  oppPlays: number;
}

export interface DefenseAgg {
  team: string;
  gp: number;
  passYdsPg: number;
  rushYdsPg: number;
  totalYdsPg: number;
  completionsPg: number;
  passTdsPg: number;
  playsFacedPg: number;
}

export interface EspnSummaryBox {
  boxscore?: {
    teams?: {
      team?: { displayName?: string; id?: string };
      homeAway?: string;
      statistics?: { name?: string; displayValue?: string }[];
    }[];
    players?: {
      team?: { displayName?: string; id?: string };
      statistics?: { name?: string; keys?: string[]; athletes?: { stats?: string[] }[] }[];
    }[];
  };
}

const num = (v: string | undefined): number => {
  if (v == null) return 0;
  const n = Number(String(v).split("/")[0].split("-")[0]);
  return Number.isFinite(n) ? n : 0;
};

function teamStat(stats: { name?: string; displayValue?: string }[] | undefined, name: string): number {
  return num(stats?.find((s) => s.name === name)?.displayValue);
}

/** Sum a passing-group key over every athlete on a team (e.g. passingTouchdowns). */
function sumPassingKey(
  players: NonNullable<EspnSummaryBox["boxscore"]>["players"],
  teamName: string,
  key: string,
): number {
  const entry = players?.find((p) => p.team?.displayName === teamName);
  const group = entry?.statistics?.find((g) => (g.name ?? "").toLowerCase() === "passing");
  if (!group) return 0;
  const idx = (group.keys ?? []).indexOf(key);
  if (idx < 0) return 0;
  return (group.athletes ?? []).reduce((s, a) => s + num(a.stats?.[idx]), 0);
}

/** Two lines per completed game: what each team allowed = the opponent's offense. */
export function extractTeamGameLines(
  summary: EspnSummaryBox,
  meta: { eventId: string; season: number; week: number | null },
): TeamGameLine[] {
  const teams = summary.boxscore?.teams ?? [];
  if (teams.length !== 2) return [];
  const [a, b] = teams;
  const nameA = a.team?.displayName;
  const nameB = b.team?.displayName;
  if (!nameA || !nameB) return [];
  const players = summary.boxscore?.players;

  const lineFor = (
    defense: string,
    offense: string,
    offStats: { name?: string; displayValue?: string }[] | undefined,
  ): TeamGameLine => ({
    eventId: meta.eventId,
    season: meta.season,
    week: meta.week,
    team: defense,
    opponent: offense,
    oppNetPassYds: teamStat(offStats, "netPassingYards"),
    oppRushYds: teamStat(offStats, "rushingYards"),
    oppTotalYds: teamStat(offStats, "totalYards"),
    oppCompletions: teamStat(offStats, "completionAttempts"),
    oppPassTds: sumPassingKey(players, offense, "passingTouchdowns"),
    oppPlays: teamStat(offStats, "totalOffensivePlays"),
  });

  return [lineFor(nameA, nameB, b.statistics), lineFor(nameB, nameA, a.statistics)];
}

export function aggregateDefense(lines: TeamGameLine[]): Map<string, DefenseAgg> {
  const acc = new Map<string, { team: string; gp: number; pass: number; rush: number; total: number; comp: number; ptd: number; plays: number }>();
  for (const l of lines) {
    const key = normalizeTeamName(l.team);
    const cur = acc.get(key) ?? { team: l.team, gp: 0, pass: 0, rush: 0, total: 0, comp: 0, ptd: 0, plays: 0 };
    cur.gp++;
    cur.pass += l.oppNetPassYds;
    cur.rush += l.oppRushYds;
    cur.total += l.oppTotalYds;
    cur.comp += l.oppCompletions;
    cur.ptd += l.oppPassTds;
    cur.plays += l.oppPlays;
    acc.set(key, cur);
  }
  const out = new Map<string, DefenseAgg>();
  for (const [key, c] of acc) {
    if (c.gp === 0) continue;
    out.set(key, {
      team: c.team,
      gp: c.gp,
      passYdsPg: round1(c.pass / c.gp),
      rushYdsPg: round1(c.rush / c.gp),
      totalYdsPg: round1(c.total / c.gp),
      completionsPg: round1(c.comp / c.gp),
      passTdsPg: round2(c.ptd / c.gp),
      playsFacedPg: round1(c.plays / c.gp),
    });
  }
  return out;
}

export function allowedForFamily(agg: DefenseAgg, family: StatFamily): number {
  switch (family) {
    case "passYds":
      return agg.passYdsPg;
    case "rush":
      return agg.rushYdsPg;
    case "completions":
      return agg.completionsPg;
    case "passTd":
      return agg.passTdsPg;
    case "total":
      return agg.totalYdsPg;
  }
}

export function familyUnit(family: StatFamily): string {
  switch (family) {
    case "passYds":
      return "pass yds";
    case "rush":
      return "rush yds";
    case "completions":
      return "completions";
    case "passTd":
      return "pass TDs";
    case "total":
      return "total yds";
  }
}

export interface DefenseRank {
  team: string;
  allowedPg: number;
  rank: number; // 1 = fewest allowed (toughest)
  gp: number;
}

/** Rank every team by per-game allowed for a family; keyed by normalized team name. */
export function rankDefense(agg: Map<string, DefenseAgg>, family: StatFamily): Map<string, DefenseRank> {
  const rows = [...agg.entries()].map(([key, a]) => ({ key, team: a.team, allowedPg: allowedForFamily(a, family), gp: a.gp }));
  rows.sort((x, y) => x.allowedPg - y.allowedPg || x.team.localeCompare(y.team));
  const out = new Map<string, DefenseRank>();
  rows.forEach((r, i) => out.set(r.key, { team: r.team, allowedPg: r.allowedPg, rank: i + 1, gp: r.gp }));
  return out;
}

/** Plays-faced tertile → pace bucket (more plays faced = more opportunities for the opponent). */
export function paceBucket(playsPg: number, all: number[]): "fast" | "average" | "slow" {
  if (all.length < 3) return "average";
  const sorted = [...all].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)];
  const hi = sorted[Math.floor((sorted.length * 2) / 3)];
  if (playsPg >= hi) return "fast";
  if (playsPg <= lo) return "slow";
  return "average";
}

export interface DefenseBasis {
  basis: "current" | "prior";
  agg: DefenseAgg;
  ranks: Map<string, DefenseRank>;
  rank: DefenseRank;
  currentGames: number;
}

/**
 * Prefer the current season once the team has `minGames` box scores; otherwise
 * fall back to the prior season (disclosed by the caller). Null when neither
 * season has data for the team.
 */
export function pickDefenseBasis(
  current: Map<string, DefenseAgg> | null,
  prior: Map<string, DefenseAgg> | null,
  teamKey: string,
  family: StatFamily,
  minGames = 3,
): DefenseBasis | null {
  const cur = current?.get(teamKey);
  const currentGames = cur?.gp ?? 0;
  if (cur && current && currentGames >= minGames) {
    const ranks = rankDefense(current, family);
    const rank = ranks.get(teamKey);
    if (rank) return { basis: "current", agg: cur, ranks, rank, currentGames };
  }
  const pri = prior?.get(teamKey);
  if (pri && prior) {
    const ranks = rankDefense(prior, family);
    const rank = ranks.get(teamKey);
    if (rank) return { basis: "prior", agg: pri, ranks, rank, currentGames };
  }
  return null;
}

/** Serialize/deserialize helpers so the aggregate can live in ProviderCache. */
export function aggToArray(agg: Map<string, DefenseAgg>): DefenseAgg[] {
  return [...agg.values()];
}
export function aggFromArray(rows: DefenseAgg[]): Map<string, DefenseAgg> {
  return new Map(rows.map((r) => [normalizeTeamName(r.team), r]));
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}
function round2(x: number) {
  return Math.round(x * 100) / 100;
}
