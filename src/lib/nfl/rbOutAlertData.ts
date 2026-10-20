import "server-only";
import { prisma } from "@/lib/db/client";
import { consensusOf, parseSnapshot } from "@/lib/marketSnapshot";
import { teamsMatch } from "@/lib/utils/teamName";
import { normName } from "@/lib/utils/playerName";
import {
  getCachedIdMap,
  getCachedWeeklyStats,
  getIdMap,
  getWeeklyStats,
  type NflverseIds,
  type WeeklyStatRow,
} from "@/lib/providers/live/nflverse";
import { buildRbOutAlert, RUSHING_PROPS, type AlertProp, type CarryShares, type RbOutAlert } from "./rbOutAlert";
import type { NflTeamInjuryReport } from "./injuryReport";
import type { NflGame } from "./schedule";
import { nflSeasonForDate } from "./slate";
import { nflverseCode } from "./teamCodes";

/**
 * Builds "RB out" alerts for a slate's games from their injury reports, the
 * stored props and nflverse carry shares. `cacheOnly` (the gameday page)
 * never touches the network: without cached nflverse data an alert shows
 * venue lines only.
 */

const WINDOW = 4; // the production usage window (nfl/usage.ts)

function carryShares(rows: WeeklyStatRow[], team: string, beforeWeek: number): CarryShares {
  const weeks = [...new Set(rows.filter((r) => r.team === team && r.week < beforeWeek).map((r) => r.week))].sort((a, b) => b - a).slice(0, WINDOW);
  const totals = new Map(weeks.map((w) => [w, rows.filter((r) => r.team === team && r.week === w).reduce((s, r) => s + (r.carries ?? 0), 0)]));
  const byPlayer = new Map<string, { pos: string; shares: number[] }>();
  for (const r of rows) {
    if (r.team !== team || !totals.has(r.week)) continue;
    const total = totals.get(r.week)!;
    if (!total) continue;
    const p = byPlayer.get(r.gsisId) ?? { pos: r.position === "FB" ? "RB" : r.position, shares: [] };
    p.shares.push((r.carries ?? 0) / total);
    byPlayer.set(r.gsisId, p);
  }
  return new Map([...byPlayer.entries()].map(([id, p]) => [id, { pos: p.pos, prior: p.shares.reduce((a, b) => a + b, 0) / p.shares.length }]));
}

function gsisForName(idMap: Map<string, NflverseIds> | null, name: string, teamGsis: Set<string>): string | null {
  if (!idMap) return null;
  const hits = [...idMap.values()].filter((r) => normName(r.name) === normName(name) && teamGsis.has(r.gsisId));
  return hits.length === 1 ? hits[0].gsisId : null;
}

export async function rbOutAlerts(
  date: string,
  games: { game: NflGame; injuries: NflTeamInjuryReport[] }[],
  opts: { cacheOnly: boolean },
): Promise<RbOutAlert[]> {
  const outs = games.flatMap(({ game, injuries }) =>
    injuries.flatMap((t) =>
      t.players
        .filter((p) => p.status === "out" && (p.position ?? "").toUpperCase() === "RB")
        .map((p) => ({ game, team: t.team, player: p })),
    ),
  );
  if (outs.length === 0) return [];
  const { season } = nflSeasonForDate(date);
  const [weekly, idMap] = season
    ? opts.cacheOnly
      ? await Promise.all([getCachedWeeklyStats(season), getCachedIdMap()])
      : await Promise.all([getWeeklyStats(season), getIdMap(season)])
    : [null, null];

  const props = await prisma.playerProp.findMany({ where: { date, sport: "NFL", isDemo: false, propType: { in: RUSHING_PROPS } } });
  const alerts: RbOutAlert[] = [];
  for (const { game, team, player } of outs) {
    const teamRef = teamsMatch(game.home.name, team) ? game.home : teamsMatch(game.away.name, team) ? game.away : null;
    if (!teamRef) continue;
    const code = nflverseCode(team);
    const shares = weekly && code && game.week ? carryShares(weekly, code, game.week) : null;
    const teamGsis = new Set(shares ? [...shares.keys()] : []);
    const alertProps: AlertProp[] = props
      .filter(
        (p) =>
          p.playerTeamId === teamRef.id &&
          ((teamsMatch(p.team, game.home.name) && teamsMatch(p.opponent, game.away.name)) ||
            (teamsMatch(p.team, game.away.name) && teamsMatch(p.opponent, game.home.name))),
      )
      .map((p) => {
        const snap = parseSnapshot(p.marketDataJson);
        return {
          playerName: p.playerName,
          propType: p.propType,
          gsisId: p.espnAthleteId && idMap ? idMap.get(p.espnAthleteId)?.gsisId ?? null : null,
          booksLine: consensusOf(snap)?.referenceLine ?? p.line,
          underdogLine: p.underdogLine,
          prizePicksLine: snap?.venues?.prizepicks ?? null,
        };
      });
    const alert = buildRbOutAlert({
      team,
      outPlayer: { name: player.name, gsisId: gsisForName(idMap, player.name, teamGsis) },
      status: player.rawStatus || player.status,
      props: alertProps,
      shares,
    });
    // A back with no carries in his last four games (long-term injured reserve)
    // is already in everyone's recent shares — not news. Without cached carry
    // data we can't tell, so the alert stays.
    if (shares && !(alert.vacatedShare != null && alert.vacatedShare > 0)) continue;
    alerts.push(alert);
  }
  return alerts;
}
