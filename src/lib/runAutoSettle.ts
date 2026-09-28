import "server-only";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";
import { lookupResult, resolveProviderContext } from "@/lib/providers";
import { propToScorable } from "@/lib/generate";
import { settlePickById } from "@/lib/settle";
import { cacheGet, cacheSet, releaseLock, tryAcquireLock } from "@/lib/providerCache";
import { toNflSlateDate } from "@/lib/nfl/slate";
import { dueForSettlement, settleRetryDue, staleForAutoSettle } from "./settleSchedule";

const LOCK_KEY = "lock:settle";
const LOCK_TTL_MS = 10 * 60_000;
const LAST_RUN_KEY = "settle:last";

/**
 * One pass of automatic settlement, run by the same two schedulers as the
 * closing-line capture. Free: results come from ESPN box scores, which refuse
 * any game not marked completed, so a pick is never graded mid-game.
 *
 * Settling used to depend on the daily job, which was never installed, or a
 * click on the Results page — so on 2026-09-28 Sunday's picks were still
 * pending the next day. Settling a pick also settles any slip it is in.
 */
export async function runAutoSettle(source: "launchd" | "app", now = new Date()): Promise<string> {
  const stamp = now.toISOString();
  const today = toNflSlateDate(stamp);
  const log = (msg: string) => `[${stamp}] ${source} settle: ${msg}`;

  const pending = await prisma.pick.findMany({
    where: { status: "pending", isDemo: false },
    include: { playerProp: true },
  });
  const stale = pending.filter((p) => staleForAutoSettle(p.playerProp.date, today));
  const staleNote = stale.length ? `; ${stale.length} older pick(s) need settling by hand on Results` : "";
  const due = pending.filter(
    (p) =>
      !staleForAutoSettle(p.playerProp.date, today) &&
      dueForSettlement(p.playerProp.gameStartTime?.toISOString() ?? null, p.playerProp.date, today, now),
  );
  if (due.length === 0) return log(`skip — nothing due${staleNote}`);

  const last = await cacheGet<string>(LAST_RUN_KEY);
  if (!settleRetryDue(last?.value, now)) return log(`skip — ${due.length} due, tried recently`);

  if (!(await tryAcquireLock(LOCK_KEY, source, LOCK_TTL_MS))) return log("skip — another settle is running");
  try {
    await cacheSet(LAST_RUN_KEY, stamp);
    const settings = await getSettings();
    let settled = 0;
    for (const pick of due) {
      // Re-read under the lock: the other scheduler may have just settled it.
      const fresh = await prisma.pick.findUnique({ where: { id: pick.id }, select: { status: true } });
      if (fresh?.status !== "pending") continue;
      const ctx = resolveProviderContext({
        propIsDemo: pick.isDemo,
        demoMode: settings.demoMode,
        enableWebResearch: settings.enableWebResearch,
      });
      const r = await lookupResult({ ...propToScorable(pick.playerProp), date: pick.playerProp.date }, ctx);
      if (r.resolved && r.actualResult != null) {
        await settlePickById(pick.id, { actualResult: r.actualResult });
        settled++;
      }
    }
    return log(
      `settled ${settled} of ${due.length} due` +
        (settled < due.length ? " (the rest not final yet — retried later)" : "") +
        staleNote,
    );
  } finally {
    await releaseLock(LOCK_KEY);
  }
}
