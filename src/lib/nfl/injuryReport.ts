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
