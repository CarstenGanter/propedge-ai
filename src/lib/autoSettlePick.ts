import "server-only";
import { lookupResult, settlementContext, usableResult } from "@/lib/providers";
import { propToScorable } from "@/lib/generate";
import { settlePickById } from "@/lib/settle";
import { cacheGet, cacheSet } from "@/lib/providerCache";
import { nflSeasonForDate } from "@/lib/nfl/slate";
import { nflverseCode } from "@/lib/nfl/teamCodes";
import { weekForScheduledGame, type ScheduledGame, type SeasonData, type StatRow } from "@/lib/nfl/gradeProps";
import { loadPfrToGsis, loadSchedule, loadSeason, loadSeasonStats } from "@/lib/nfl/nflverseSeasons";
import { snapFallbackDecision, type SnapDecision } from "@/lib/nfl/snapFallback";
import type { Pick, PlayerProp } from "@prisma/client";

/**
 * Settle one pick from its result lookup — the one path the auto-settle pass,
 * the Results page and the daily job all use, so a pick settles the same way
 * whichever runs. A final box-score stat settles it; an NFL player missing
 * from the box score is graded from nflverse snap counts once nflverse has
 * posted the game (snapFallback.ts); anything else is left for the Results
 * page with the reason.
 */
export type PickOutcome =
  | { kind: "settled"; via: "box-score" | "snap-counts" }
  | { kind: "waiting"; reason: string }
  | { kind: "unresolved"; note: string };

const manualKey = (pickId: string) => `settle:snaps-manual:${pickId}`;
/**
 * How long a "nflverse can't settle it" verdict holds before the pick is tried
 * again: nflverse corrects stat lines and rosters overnight. An operational
 * re-check interval, not a model value; the 3-day give-up still applies.
 */
const MANUAL_RECHECK_MS = 24 * 3_600_000;

export function createSettler(settings: { enableWebResearch: boolean }) {
  const snaps = nflverseFallback();
  return {
    async settle(pick: Pick & { playerProp: PlayerProp }): Promise<PickOutcome> {
      const r = await lookupResult({ ...propToScorable(pick.playerProp), date: pick.playerProp.date }, settlementContext(pick, settings));
      if (usableResult(pick, r)) {
        await settlePickById(pick.id, { actualResult: r.actualResult });
        return { kind: "settled", via: "box-score" };
      }
      if (!(r.absentFromBoxScore && pick.playerProp.sport === "NFL")) return { kind: "unresolved", note: r.note ?? "Manual settlement required." };
      const cachedManual = await cacheGet<string>(manualKey(pick.id), MANUAL_RECHECK_MS);
      if (cachedManual) return { kind: "unresolved", note: `Not in the box score; nflverse can't settle it: ${cachedManual.value}` };
      const d = await snaps.decide(pick.playerProp);
      if (d.kind === "settle") {
        await settlePickById(pick.id, { actualResult: d.actualResult, appendNote: d.note });
        return { kind: "settled", via: "snap-counts" };
      }
      if (d.kind === "void") {
        await settlePickById(pick.id, { status: "void", actualResult: null, appendNote: d.note });
        return { kind: "settled", via: "snap-counts" };
      }
      if (d.kind === "wait") return { kind: "waiting", reason: d.reason };
      // nflverse can't settle it (name or source disagreement): don't re-download every pass.
      await cacheSet(manualKey(pick.id), d.reason);
      return { kind: "unresolved", note: `Not in the box score; nflverse can't settle it: ${d.reason}` };
    },
  };
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
