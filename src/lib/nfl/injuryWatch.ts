import "server-only";
import { prisma } from "@/lib/db/client";
import { releaseLock, tryAcquireLock } from "@/lib/providerCache";
import { diffInjuryReports, parseInjuryReport, type EspnSummaryInjuries } from "./injuryReport";
import { getNflSlate, type NflGame } from "./schedule";
import { rbOutAlerts } from "./rbOutAlertData";
import { formatRbOutAlert } from "./rbOutAlert";
import { queueNewsFetches } from "./newsFetch";
import { toNflSlateDate } from "./slate";

/**
 * Logs every injury-report status change for games in the next 96 hours, with
 * the time we first saw it (InjuryStatusChange). Free: ESPN game summaries.
 * Runs with the 15-minute schedulers, so a change is timed to within ~15
 * minutes; the news-latency test measures venue line moves from these times.
 * A lock keeps the app and launchd from logging one change twice.
 */

const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=";
// 96 hours, so Friday afternoon's final report reaches Monday night's game too.
const LOOKAHEAD_MS = 96 * 3_600_000;
const LOCK_KEY = "lock:nfl:injury-watch";
const LOCK_TTL_MS = 10 * 60_000;

async function fetchSummary(eventId: string): Promise<EspnSummaryInjuries | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(`${SUMMARY}${eventId}`, { signal: controller.signal, cache: "no-store", headers: { accept: "application/json" } });
    return res.ok ? ((await res.json()) as EspnSummaryInjuries) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function upcomingGames(now: Date): Promise<NflGame[]> {
  const games = new Map<string, NflGame>();
  for (let d = 0; d <= 4; d++) {
    const date = toNflSlateDate(new Date(now.getTime() + d * 86_400_000).toISOString());
    for (const g of await getNflSlate(date)) {
      const t = Date.parse(g.kickoffISO);
      if (!g.completed && t > now.getTime() && t - now.getTime() <= LOOKAHEAD_MS) games.set(g.eventId, g);
    }
  }
  return [...games.values()];
}

export async function runInjuryWatch(source: "launchd" | "app", now = new Date()): Promise<string> {
  const stamp = now.toISOString();
  const log = (msg: string) => `[${stamp}] ${source} injury-watch: ${msg}`;
  if (!(await tryAcquireLock(LOCK_KEY, source, LOCK_TTL_MS))) return log("skip — already running");
  try {
    const games = await upcomingGames(now);
    if (games.length === 0) return log("skip — no games in the next 96 hours");
    let changes = 0;
    let toOut = 0;
    const alertLines: string[] = [];
    for (const g of games) {
      const summary = await fetchSummary(g.eventId);
      if (!summary) continue;
      const rows = await prisma.injuryStatusChange.findMany({
        where: { eventId: g.eventId },
        orderBy: { detectedAt: "asc" },
        select: { team: true, playerName: true, toStatus: true },
      });
      const previous = new Map<string, string>();
      for (const r of rows) previous.set(`${r.team}|${r.playerName}`, r.toStatus);
      const diff = diffInjuryReports(previous, parseInjuryReport(summary));
      if (diff.length === 0) continue;
      await prisma.injuryStatusChange.createMany({
        data: diff.map((c) => ({ ...c, detectedAt: now, eventId: g.eventId, kickoff: new Date(g.kickoffISO) })),
      });
      changes += diff.length;
      toOut += diff.filter((c) => c.toStatus === "out").length;
      // A running back newly out: alert with his teammates' rushing lines (not a probability change).
      const rbOut = diff.filter((c) => c.toStatus === "out" && c.fromStatus != null && (c.position ?? "").toUpperCase() === "RB");
      if (rbOut.length) {
        const report = parseInjuryReport(summary).map((t) => ({ ...t, players: t.players.filter((p) => rbOut.some((c) => c.team === t.team && c.playerName === p.name)) }));
        const alerts = await rbOutAlerts(toNflSlateDate(g.kickoffISO), [{ game: g, injuries: report }], { cacheOnly: false });
        for (const a of alerts) alertLines.push(...formatRbOutAlert(a));
        // The news-fetch trial: only backs whose alert survived (recent carries).
        const logged = await prisma.injuryStatusChange.findMany({
          where: { eventId: g.eventId, detectedAt: now, toStatus: "out", playerName: { in: alerts.map((a) => a.outPlayer) } },
          select: { id: true, team: true, playerName: true, detectedAt: true },
        });
        alertLines.push(...(await queueNewsFetches(g, logged.map((r) => ({ changeId: r.id, team: r.team, playerName: r.playerName, detectedAt: r.detectedAt })))));
      }
    }
    const summaryLine = changes ? log(`${changes} status change(s) across ${games.length} game(s), ${toOut} to Out`) : log(`skip — no changes in ${games.length} game(s)`);
    return [summaryLine, ...alertLines.map((l) => log(l))].join("\n");
  } finally {
    await releaseLock(LOCK_KEY);
  }
}
