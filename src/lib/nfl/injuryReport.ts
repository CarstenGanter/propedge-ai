import { mapInjuryStatus, type InjuryStatus } from "@/lib/providers/live/espnInjuries";
import { nameMatches } from "@/lib/providers/live/espn";
import { positionsBoostingProp } from "./slate";

/**
 * Pure parsing of ESPN's per-game injury report (from the game summary) and
 * the teammate-absence rule. Kept free of server-only imports so it's testable.
 */

export interface NflInjuryEntry {
  name: string;
  position: string | null;
  status: InjuryStatus;
  rawStatus: string;
  detail: string | null; // e.g. "Heel"
  date: string | null;
  comment: string | null;
}

export interface NflTeamInjuryReport {
  team: string;
  players: NflInjuryEntry[];
}

export interface EspnSummaryInjuries {
  injuries?: {
    team?: { displayName?: string };
    injuries?: {
      status?: string;
      date?: string;
      longComment?: string;
      shortComment?: string;
      details?: { type?: string; detail?: string };
      athlete?: { displayName?: string; position?: { abbreviation?: string } };
    }[];
  }[];
}

export function parseInjuryReport(summary: EspnSummaryInjuries): NflTeamInjuryReport[] {
  const out: NflTeamInjuryReport[] = [];
  for (const t of summary.injuries ?? []) {
    const team = t.team?.displayName;
    if (!team) continue;
    const players: NflInjuryEntry[] = [];
    for (const it of t.injuries ?? []) {
      const name = it.athlete?.displayName;
      if (!name) continue;
      const rawStatus = it.status ?? "";
      players.push({
        name,
        position: it.athlete?.position?.abbreviation ?? null,
        status: mapInjuryStatus({ statusName: rawStatus }),
        rawStatus,
        detail: it.details?.type ?? null,
        date: it.date ?? null,
        comment: it.longComment || it.shortComment || null,
      });
    }
    out.push({ team, players });
  }
  return out;
}

/**
 * Does a teammate's absence open opportunity for this prop? Only out/doubtful
 * (incl. IR) count; questionable does not. The player himself is excluded.
 * Passing props get no boost (a QB's targets don't disappear).
 */
export function teammateAbsenceBoost(
  propType: string,
  playerName: string,
  report: NflTeamInjuryReport | undefined,
): { boost: boolean; names: string[] } {
  const positions = positionsBoostingProp(propType);
  if (!report || positions.length === 0) return { boost: false, names: [] };
  const names = report.players
    .filter(
      (p) =>
        (p.status === "out" || p.status === "doubtful") &&
        p.position != null &&
        positions.includes(p.position.toUpperCase()) &&
        !nameMatches(p.name, playerName),
    )
    .map((p) => `${p.name} (${p.position}, ${p.rawStatus || p.status})`);
  return { boost: names.length > 0, names };
}

export interface InjuryChange {
  team: string;
  playerName: string;
  position: string | null;
  fromStatus: string | null;
  toStatus: string;
  rawStatus: string | null;
}

/** Players we last recorded with a status who are missing from the report now (keys `${team}|${playerName}`). */
export function missingFromReport(previous: Map<string, string>, current: NflTeamInjuryReport[]): Set<string> {
  const seen = new Set(current.flatMap((t) => t.players.map((p) => `${t.team}|${p.name}`)));
  return new Set([...previous].filter(([key, status]) => status !== "cleared" && !seen.has(key)).map(([key]) => key));
}

/**
 * What changed between the last statuses we recorded for a game and its
 * report now (pure). A new name is a change from null. A name that drops off
 * the report is "cleared" — ESPN removes players once they're off it — but
 * only when it was also missing at the previous check (`absentLastCheck`, from
 * missingFromReport then): ESPN's report flaps, and on 2026-10-20 A.J. Brown
 * went questionable → cleared → questionable → cleared within hours. One
 * missing fetch is not news. `previous` is keyed `${team}|${playerName}`.
 */
export function diffInjuryReports(
  previous: Map<string, string>,
  current: NflTeamInjuryReport[],
  absentLastCheck: Set<string> = new Set(),
): InjuryChange[] {
  const out: InjuryChange[] = [];
  const seen = new Set<string>();
  for (const t of current) {
    for (const p of t.players) {
      const key = `${t.team}|${p.name}`;
      seen.add(key);
      const before = previous.get(key) ?? null;
      if (before !== p.status) {
        out.push({ team: t.team, playerName: p.name, position: p.position, fromStatus: before, toStatus: p.status, rawStatus: p.rawStatus || null });
      }
    }
  }
  for (const [key, status] of previous) {
    if (seen.has(key) || status === "cleared" || !absentLastCheck.has(key)) continue;
    const [team, playerName] = key.split("|");
    out.push({ team, playerName, position: null, fromStatus: status, toStatus: "cleared", rawStatus: null });
  }
  return out;
}

/**
 * A change to Out that counts as news, for the news-fetch trial and the
 * latency test: from a real earlier status. A first sighting (from null) has
 * no "before", and "cleared → out" is a player reappearing on the report —
 * usually a flap, not news.
 */
export const NOT_NEWS_FROM = ["out", "cleared"] as const;
export function isNewsworthyOut(c: { fromStatus: string | null; toStatus: string }): boolean {
  return c.toStatus === "out" && c.fromStatus != null && !(NOT_NEWS_FROM as readonly string[]).includes(c.fromStatus);
}
