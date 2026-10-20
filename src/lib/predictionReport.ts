import "server-only";
import { prisma } from "@/lib/db/client";
import { overGap, roiWithPayouts, skillReport, type OverGap, type SkillItem, type SkillReport } from "@/lib/analysis/marketSkill";
import { BASELINE_V0, type MarketMethod } from "@/lib/predictionLog";

/**
 * Scored forecasts from the log, for the model-vs-market report. One forecast
 * per prop: for live rows the last one made before kickoff (a re-rank after
 * kickoff is not a forecast); backfill rows have one each. Pushes and props
 * without an outcome are left out.
 */
export async function loadSkillItems(filter: {
  source: "live" | "backfill";
  marketMethod: MarketMethod;
  modelVersion?: string;
  /** reference (the books' line), venue (Underdog's), prizepicks. Backfill defaults to reference. */
  lineKind?: string;
}): Promise<SkillItem[]> {
  const lineKind = filter.lineKind ?? (filter.source === "backfill" ? "reference" : undefined);
  const rows = await prisma.propPrediction.findMany({
    where: {
      source: filter.source,
      marketMethod: filter.marketMethod,
      ...(filter.modelVersion ? { modelVersion: filter.modelVersion } : {}),
      ...(lineKind ? { lineKind } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      playerProp: { select: { actualResult: true, gameStartTime: true, date: true, team: true, opponent: true, propType: true } },
    },
  });
  const seen = new Set<string>();
  const items: SkillItem[] = [];
  for (const r of rows) {
    const p = r.playerProp;
    if (seen.has(r.playerPropId)) continue;
    const madeAt = filter.source === "live" ? r.createdAt : r.quotedAt;
    if (p.gameStartTime && madeAt > p.gameStartTime) continue;
    seen.add(r.playerPropId);
    if (p.actualResult == null || p.actualResult === r.line) continue;
    items.push({
      pModel: r.modelProbOver,
      pMarket: r.marketProbOver,
      over: p.actualResult > r.line,
      cluster: `${p.date}|${p.team}|${p.opponent}`,
      propType: p.propType,
      edgeSource: r.edgeSource,
      date: p.date,
    });
  }
  return items;
}

/** The model versions that have live rows, newest first. */
export async function liveModelVersions(): Promise<string[]> {
  const rows = await prisma.propPrediction.groupBy({ by: ["modelVersion"], where: { source: "live" }, _max: { createdAt: true } });
  return rows.sort((a, b) => (b._max.createdAt?.getTime() ?? 0) - (a._max.createdAt?.getTime() ?? 0)).map((r) => r.modelVersion);
}

/** ROI on settled NFL picks with Underdog's payout entered — the only place real payouts exist. */
export async function payoutRoi() {
  const picks = await prisma.pick.findMany({
    where: { isDemo: false, status: { in: ["hit", "miss"] }, playerProp: { sport: "NFL", underdogPickMultiplier: { not: null } } },
    select: { status: true, playerProp: { select: { underdogPickMultiplier: true } } },
  });
  return roiWithPayouts(picks.map((p) => ({ payout: p.playerProp.underdogPickMultiplier!, won: p.status === "hit" })));
}

export interface SkillSection {
  title: string;
  note: string;
  items: number;
  report: SkillReport | null;
}

export async function skillSection(
  title: string,
  note: string,
  filter: Parameters<typeof loadSkillItems>[0],
  opts: { reps?: number } = {},
): Promise<SkillSection> {
  const items = await loadSkillItems(filter);
  return { title, note, items: items.length, report: items.length ? skillReport(items, opts) : null };
}

export interface OverGapRow {
  label: string;
  gap: OverGap | null;
}

/**
 * The standing Over-vs-books metric: at Underdog and PrizePicks lines, how
 * often the Over landed minus the books' P(over). Backfilled rows and live
 * rows are separate lines, never pooled.
 */
export async function overGapRows(modelVersions: string[], opts: { reps?: number } = {}): Promise<OverGapRow[]> {
  const rows: OverGapRow[] = [];
  for (const [label, lineKind] of [
    ["Underdog lines", "venue"],
    ["PrizePicks lines", "prizepicks"],
  ] as const) {
    const items = await loadSkillItems({ source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0, lineKind });
    rows.push({ label: `${label} — graded history`, gap: overGap(items, opts) });
  }
  for (const v of modelVersions) {
    const items = await loadSkillItems({ source: "live", marketMethod: "consensus-v2", modelVersion: v, lineKind: "venue" });
    rows.push({ label: `Underdog lines — live forecasts, model ${v}`, gap: overGap(items, opts) });
  }
  return rows;
}
