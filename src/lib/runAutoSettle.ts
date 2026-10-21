import "server-only";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";
import { lookupResult, resolveProviderContext } from "@/lib/providers";
import { propToScorable } from "@/lib/generate";
import { settlePickById } from "@/lib/settle";
import { cacheGet, cacheSet, releaseLock, tryAcquireLock } from "@/lib/providerCache";
import { toNflSlateDate } from "@/lib/nfl/slate";
import { dueForSettlement, settleRetryDue, staleForAutoSettle } from "./settleSchedule";
import { nflSeasonForDate } from "@/lib/nfl/slate";
import { nflverseCode } from "@/lib/nfl/teamCodes";
import { weekForScheduledGame, type ScheduledGame, type SeasonData, type StatRow } from "@/lib/nfl/gradeProps";
import { loadPfrToGsis, loadSchedule, loadSeason, loadSeasonStats } from "@/lib/nfl/nflverseSeasons";
import { snapFallbackDecision, type SnapDecision } from "@/lib/nfl/snapFallback";
import type { PlayerProp } from "@prisma/client";

const LOCK_KEY = "lock:settle";
const LOCK_TTL_MS = 10 * 60_000;
const LAST_RUN_KEY = "settle:last";
const manualKey = (pickId: string) => `settle:snaps-manual:${pickId}`;

/**
 * One pass of automatic settlement, run by the same two schedulers as the
 * closing-line capture. Free: results come from ESPN box scores, which refuse
 * any game not marked completed, so a pick is never graded mid-game.
 *
 * Settling used to depend on the daily job, which was never installed, or a
 * click on the Results page — so on 2026-09-28 Sunday's picks were still
 * pending the next day. Settling a pick also settles any slip it is in.
 *
 * An NFL player missing from a final game's box score is graded from nflverse
 * snap counts instead (snapFallback.ts) once nflverse has posted the game;
 * until then the pick waits, and after SETTLE_GIVE_UP_DAYS it is left for the
 * Results page like everything else.
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
    const snaps = nflverseFallback();
    let settled = 0;
    let fromSnaps = 0;
    let waiting = 0;
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
      } else if (r.absentFromBoxScore && pick.playerProp.sport === "NFL" && !(await cacheGet<string>(manualKey(pick.id)))) {
        const d = await snaps.decide(pick.playerProp);
        // nflverse can't settle it (name or source disagreement): don't re-download every pass.
        if (d.kind === "manual") await cacheSet(manualKey(pick.id), d.reason);
        if (d.kind === "settle") await settlePickById(pick.id, { actualResult: d.actualResult, note: d.note });
        else if (d.kind === "void") await settlePickById(pick.id, { status: "void", actualResult: null, note: d.note });
        if (d.kind === "settle" || d.kind === "void") {
          settled++;
          fromSnaps++;
        } else if (d.kind === "wait") waiting++;
      }
    }
    return log(
      `settled ${settled} of ${due.length} due` +
        (fromSnaps ? ` (${fromSnaps} from nflverse snap counts)` : "") +
        (waiting ? `; ${waiting} not in the box score, waiting for nflverse` : "") +
        (settled + waiting < due.length ? " (the rest not final yet — retried later)" : "") +
        staleNote,
    );
  } finally {
    await releaseLock(LOCK_KEY);
  }
}

/**
 * nflverse loaded at most once per pass and only as far as needed: the small
 * stats file answers "is the game posted?"; snap counts and rosters (~13 MB)
 * are fetched only for a game that is. A failed download means wait.
 */
function nflverseFallback() {
  const stats = new Map<number, Promise<StatRow[]>>();
  const schedules = new Map<number, Promise<ScheduledGame[]>>();
  const seasons = new Map<number, Promise<SeasonData>>();
  let pfr: Promise<Map<string, string>> | null = null;
  return {
    async decide(prop: PlayerProp): Promise<SnapDecision> {
      const home = nflverseCode(prop.team);
      const away = nflverseCode(prop.opponent);
      if (!home || !away) return { kind: "manual", reason: "team name has no nflverse code" };
      const { season } = nflSeasonForDate(prop.date);
      try {
        if (!stats.has(season)) stats.set(season, loadSeasonStats(season));
        if (!schedules.has(season)) schedules.set(season, loadSchedule(season));
        const [rows, schedule] = await Promise.all([stats.get(season)!, schedules.get(season)!]);
        // The game's own week (a rematch of division rivals is another week entirely).
        const week = weekForScheduledGame(schedule, { home, away, date: prop.date, espnGameId: prop.gameId });
        if (week == null) return { kind: "wait", reason: "game not found in the nflverse schedule" };
        if (!rows.some((r) => r.week === week && (r.team === home || r.team === away))) return { kind: "wait", reason: "nflverse has not posted the game yet" };
        pfr ??= loadPfrToGsis();
        if (!seasons.has(season)) seasons.set(season, pfr.then((m) => loadSeason(season, m, { rows, schedule })));
        return snapFallbackDecision(
          { playerName: prop.playerName, espnId: prop.espnAthleteId, propType: prop.propType, home, away, date: prop.date, espnGameId: prop.gameId },
          await seasons.get(season)!,
        );
      } catch (e) {
        return { kind: "wait", reason: `nflverse download failed: ${String(e)}` };
      }
    },
  };
}
