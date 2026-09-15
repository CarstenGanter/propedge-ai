import type { SnapRow, WeeklyStatRow } from "@/lib/providers/live/nflverse";

/**
 * Turn nflverse weekly rows into a player's recent role (pure, tested).
 *
 * Share beats count. A receiver's three targets mean one thing on 90% of snaps
 * and something else entirely on 30%, and only the share distinguishes them. We
 * weight recent weeks more heavily but keep it simple and transparent: a mean
 * over the last N weeks plus a trend against the weeks before them.
 */

export interface PlayerUsage {
  /** Share of team offensive snaps, 0..1. */
  snapPct: number | null;
  /** Share of team targets, 0..1. */
  targetShare: number | null;
  airYardsShare: number | null;
  /** Direction of travel for snap share. */
  trend: "up" | "down" | "steady" | null;
  weeksUsed: number;
  latestWeek: number | null;
  position: string | null;
  team: string | null;
}

/** A change in snap share smaller than this is not a role change. */
export const TREND_BAND = 0.08;

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

function recentFirst<T extends { week: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.week - a.week);
}

/**
 * Snap share over the last `window` weeks, and whether it is rising against the
 * weeks immediately before. Returns nulls rather than guesses when absent.
 */
export function summarizeUsage(
  weekly: WeeklyStatRow[],
  snaps: SnapRow[],
  window = 4,
): PlayerUsage {
  const w = recentFirst(weekly);
  const s = recentFirst(snaps);

  const recentSnaps = s.slice(0, window).map((r) => r.offensePct).filter((x): x is number => x != null);
  const priorSnaps = s.slice(window, window * 2).map((r) => r.offensePct).filter((x): x is number => x != null);
  const snapPct = mean(recentSnaps);
  const priorPct = mean(priorSnaps);

  let trend: PlayerUsage["trend"] = null;
  if (snapPct != null) {
    if (priorPct == null) trend = "steady";
    else if (snapPct - priorPct > TREND_BAND) trend = "up";
    else if (priorPct - snapPct > TREND_BAND) trend = "down";
    else trend = "steady";
  }

  const recentWeekly = w.slice(0, window);
  const latest = w[0] ?? s[0];

  return {
    snapPct,
    targetShare: mean(recentWeekly.map((r) => r.targetShare).filter((x): x is number => x != null)),
    airYardsShare: mean(recentWeekly.map((r) => r.airYardsShare).filter((x): x is number => x != null)),
    trend,
    weeksUsed: Math.max(recentSnaps.length, recentWeekly.length),
    latestWeek: latest?.week ?? null,
    position: (w[0]?.position || s[0]?.position) ?? null,
    team: (w[0]?.team || s[0]?.team) ?? null,
  };
}

/**
 * Targets vacated by team-mates who are out, as a share of team targets.
 *
 * This replaces a flat "someone is out" flag, which treated the WR4 sitting the
 * same as the WR1 sitting. Most of the time it should *suppress* a boost that
 * should never have fired.
 */
export interface VacatedShare {
  share: number;
  contributors: { name: string; share: number }[];
}

export function vacatedTargetShare(
  absentPlayers: { name: string; gsisId: string | null }[],
  weekly: WeeklyStatRow[],
  window = 4,
): VacatedShare {
  const byPlayer = new Map<string, WeeklyStatRow[]>();
  for (const r of weekly) {
    const list = byPlayer.get(r.gsisId) ?? [];
    list.push(r);
    byPlayer.set(r.gsisId, list);
  }
  const contributors: { name: string; share: number }[] = [];
  for (const a of absentPlayers) {
    if (!a.gsisId) continue; // unmatched: exclude rather than impute
    const rows = recentFirst(byPlayer.get(a.gsisId) ?? []).slice(0, window);
    const share = mean(rows.map((r) => r.targetShare).filter((x): x is number => x != null));
    if (share != null && share > 0) contributors.push({ name: a.name, share });
  }
  contributors.sort((x, y) => y.share - x.share);
  return {
    share: contributors.reduce((sum, c) => sum + c.share, 0),
    contributors,
  };
}

/** Target share a receiver would need to matter; below this an absence is noise. */
export const MEANINGFUL_VACATED_SHARE = 0.08;
