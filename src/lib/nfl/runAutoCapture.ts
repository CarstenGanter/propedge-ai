import "server-only";
import { prisma } from "@/lib/db/client";
import { captureClosingLines } from "@/lib/captureLines";
import { releaseLock, tryAcquireLock } from "@/lib/providerCache";
import { getNflSlate } from "./schedule";
import { toNflSlateDate } from "./slate";
import { decideCapture, inCaptureWindow } from "./autoCapture";

const LOCK_KEY = "lock:closing-capture";
const LOCK_TTL_MS = 10 * 60_000;

/**
 * One pass of the automatic closing-line capture, shared by the launchd job
 * (runs even with the app closed) and the in-app scheduler (runs while the dev
 * server is up). Cheapest check first: a database count, then a cached, free
 * schedule read. Credits are spent only when a game with uncaptured picks is
 * 20-60 minutes from kickoff, and a lock ensures the two schedulers never both
 * pay for it.
 *
 * Returns a one-line summary for the caller to log.
 */
export async function runAutoCapture(source: "launchd" | "app", now = new Date()): Promise<string> {
  const stamp = now.toISOString();
  const date = toNflSlateDate(stamp);

  const uncaptured = await prisma.pick.count({
    where: {
      date,
      status: "pending",
      isDemo: false,
      closingProb: null,
      playerProp: { sport: "NFL", source: "The Odds API" },
    },
  });
  const kickoffs = uncaptured > 0 ? (await getNflSlate(date)).map((g) => g.kickoffISO) : [];
  const decision = decideCapture(uncaptured, kickoffs, now);
  if (decision.action === "skip") return `[${stamp}] ${source} ${date}: skip — ${decision.reason}`;

  if (!(await tryAcquireLock(LOCK_KEY, source, LOCK_TTL_MS))) {
    return `[${stamp}] ${source} ${date}: skip — another capture is already running`;
  }
  try {
    const r = await captureClosingLines({
      date,
      includeProps: true,
      includeTeamPicks: false,
      onlyUncaptured: true, // re-checked under the lock, so a finished capture is never repeated
      sports: ["NFL"],
      eventFilter: (iso) => inCaptureWindow(iso, now),
    });
    if (!r.ok) return `[${stamp}] ${source} ${date}: FAILED — ${r.error}`;
    return (
      `[${stamp}] ${source} ${date}: captured ${r.propPicksUpdated} pick(s) for ` +
      `${decision.kickoffs.length} game(s). Credits remaining: ${r.creditsRemaining ?? "unknown"}`
    );
  } finally {
    await releaseLock(LOCK_KEY);
  }
}
