import "server-only";
import { prisma } from "@/lib/db/client";
import { getOddsCredits, recordOddsCredits, releaseLock, tryAcquireLock } from "@/lib/providerCache";
import { getSettings } from "@/lib/settings";
import { hasKey } from "@/lib/providers/config";
import { fetchPlayerProps } from "@/lib/providers/live/theOddsApi";
import { saveQuotes } from "@/lib/oddsStore";
import { withCreditKind } from "@/lib/creditLedger";
import { teamsMatch } from "@/lib/utils/teamName";
import { canReserve, classifyWindow, NEWS_TRIAL, planFetches, shouldExecute } from "./newsFetchTrial";
import type { NflGame } from "./schedule";

/**
 * The news-fetch trial at work (rules in newsFetchTrial.ts). The injury watch
 * queues an event's two fetches when a running back with recent carries is
 * newly ruled Out in an approved window; the schedulers run them when due.
 */

const LOCK_KEY = "lock:nfl:news-fetch";
const LOCK_TTL_MS = 10 * 60_000;

/** Credits the trial has spent, plus what queued fetches still hold in reserve. */
async function committedCredits(): Promise<number> {
  const rows = await prisma.newsFetch.findMany({ where: { status: { in: ["queued", "done"] } }, select: { status: true, creditsReserved: true, creditsSpent: true } });
  return rows.reduce((s, r) => s + (r.status === "done" ? r.creditsSpent ?? r.creditsReserved : r.creditsReserved), 0);
}

/** Queue fetches for running backs newly out in this game. Returns log lines. */
export async function queueNewsFetches(
  game: NflGame,
  outs: { changeId: string; team: string; playerName: string; detectedAt: Date }[],
): Promise<string[]> {
  const lines: string[] = [];
  const kickoff = new Date(game.kickoffISO);
  for (const o of outs) {
    const window = classifyWindow(o.detectedAt, kickoff);
    if (!window) {
      lines.push(`news-fetch: ${o.playerName} out — outside the trial's windows (Friday report, inactives), not fetched`);
      continue;
    }
    const settings = await getSettings();
    const check = canReserve({
      now: o.detectedAt,
      committed: await committedCredits(),
      creditsRemaining: (await getOddsCredits())?.remaining ?? null,
      creditFloor: settings.oddsCreditFloor,
    });
    if (!check.ok) {
      lines.push(`news-fetch: ${o.playerName} out (${window}) — skipped: ${check.reason}`);
      continue;
    }
    await prisma.newsFetch.createMany({
      data: planFetches(o.detectedAt).map((f) => ({
        changeId: o.changeId,
        window,
        eventId: game.eventId,
        homeTeam: game.home.name,
        awayTeam: game.away.name,
        kickoff,
        team: o.team,
        playerName: o.playerName,
        seq: f.seq,
        dueAt: f.dueAt,
        status: "queued",
        creditsReserved: NEWS_TRIAL.creditsPerFetch,
      })),
    });
    lines.push(`news-fetch: ${o.playerName} out (${window}) — queued 2 fetches of ${game.away.name} @ ${game.home.name} rushing markets, ${check.credits} credits reserved`);
  }
  return lines;
}

/** Run every queued fetch that is due. */
export async function runNewsFetches(source: "launchd" | "app", now = new Date()): Promise<string> {
  const stamp = now.toISOString();
  const log = (msg: string) => `[${stamp}] ${source} news-fetch: ${msg}`;
  const queued = await prisma.newsFetch.count({ where: { status: "queued", dueAt: { lte: now } } });
  if (queued === 0) return log("skip — nothing due");
  if (!(await tryAcquireLock(LOCK_KEY, source, LOCK_TTL_MS))) return log("skip — already running");
  const done: string[] = [];
  try {
    const due = await prisma.newsFetch.findMany({ where: { status: "queued", dueAt: { lte: now } }, orderBy: { dueAt: "asc" } });
    const floor = (await getSettings()).oddsCreditFloor;
    for (const f of due) {
      const gate = shouldExecute(f.dueAt, f.kickoff, now);
      if (!gate.go) {
        await prisma.newsFetch.update({ where: { id: f.id }, data: { status: "skipped", note: gate.reason, executedAt: now } });
        done.push(`${f.playerName} #${f.seq} skipped (${gate.reason})`);
        continue;
      }
      const before = (await getOddsCredits())?.remaining ?? null;
      if (!hasKey("ODDS_API_KEY") || (before != null && before - NEWS_TRIAL.creditsPerFetch < floor)) {
        const note = !hasKey("ODDS_API_KEY") ? "no ODDS_API_KEY" : `would go below the credit floor (${before} left, floor ${floor})`;
        await prisma.newsFetch.update({ where: { id: f.id }, data: { status: "skipped", note, executedAt: now } });
        done.push(`${f.playerName} #${f.seq} skipped (${note})`);
        continue;
      }
      const res = await withCreditKind("news", () =>
        fetchPlayerProps(process.env.ODDS_API_KEY!, "NFL", {
          maxEvents: 1,
          propTypes: [...NEWS_TRIAL.propTypes],
          eventFilter: (e) => teamsMatch(e.home_team, f.homeTeam) && teamsMatch(e.away_team, f.awayTeam),
        }),
      );
      await recordOddsCredits(res.status.remaining, res.status.used);
      const fetchedAt = new Date();
      const stored = await saveQuotes(res.quotes, fetchedAt, "news");
      const spent = before != null && res.status.remaining != null ? Math.max(0, before - res.status.remaining) : NEWS_TRIAL.creditsPerFetch;
      await prisma.newsFetch.update({
        where: { id: f.id },
        data: {
          status: res.status.error && stored === 0 ? "failed" : "done",
          creditsSpent: spent,
          quotes: stored,
          note: res.status.error ?? null,
          executedAt: fetchedAt,
        },
      });
      done.push(`${f.playerName} #${f.seq}: ${stored} quotes, ${spent} credits${res.status.error ? ` (${res.status.error})` : ""}`);
    }
  } finally {
    await releaseLock(LOCK_KEY);
  }
  return log(`${done.join("; ")}. Trial total ${await committedCredits()} of ${NEWS_TRIAL.budgetCredits} credits.`);
}
