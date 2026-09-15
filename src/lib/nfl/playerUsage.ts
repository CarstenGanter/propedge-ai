import "server-only";
import { getIdMap, getSnapCounts, getWeeklyStats } from "@/lib/providers/live/nflverse";
import { summarizeUsage, vacatedTargetShare, type PlayerUsage, type VacatedShare } from "./usage";
import { nflSeasonForDate } from "./slate";

/**
 * Server-side glue between an ESPN athlete id and nflverse role data. The join
 * is exact (nflverse ships `espn_id`), so a player either matches or is skipped
 * — there is no fuzzy matching and therefore no chance of attaching another
 * player's usage.
 */

export async function getNflPlayerUsage(
  espnAthleteId: string,
  slateDate: string,
): Promise<PlayerUsage | null> {
  const { season, prior } = nflSeasonForDate(slateDate);
  const idMap = await getIdMap(season);
  const ids = idMap.get(espnAthleteId);
  if (!ids) return null;

  const [weekly, snaps] = await Promise.all([getWeeklyStats(season), getSnapCounts(season)]);
  let usage = summarizeUsage(
    weekly.filter((w) => w.gsisId === ids.gsisId),
    snaps.filter((s) => s.pfrId === ids.pfrId),
  );

  // Early in a season there may be nothing yet; last year's role is a better
  // prior than none, and the caller discloses which season it came from.
  if (usage.snapPct == null && usage.targetShare == null) {
    const [pw, ps] = await Promise.all([getWeeklyStats(prior), getSnapCounts(prior)]);
    const priorUsage = summarizeUsage(
      pw.filter((w) => w.gsisId === ids.gsisId),
      ps.filter((s) => s.pfrId === ids.pfrId),
    );
    if (priorUsage.snapPct != null || priorUsage.targetShare != null) {
      usage = { ...priorUsage, trend: null };
    }
  }
  return usage.snapPct == null && usage.targetShare == null ? null : usage;
}

/** Vacated target share for team-mates ruled out, sized by what they actually commanded. */
export async function getVacatedShare(
  absent: { name: string; espnAthleteId: string | null }[],
  slateDate: string,
): Promise<VacatedShare> {
  if (absent.length === 0) return { share: 0, contributors: [] };
  const { season } = nflSeasonForDate(slateDate);
  const [idMap, weekly] = await Promise.all([getIdMap(season), getWeeklyStats(season)]);
  return vacatedTargetShare(
    absent.map((a) => ({
      name: a.name,
      gsisId: a.espnAthleteId ? (idMap.get(a.espnAthleteId)?.gsisId ?? null) : null,
    })),
    weekly,
  );
}
