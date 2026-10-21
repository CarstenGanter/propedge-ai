import "server-only";
import { prisma } from "@/lib/db/client";
import { overGap, overGapStatus, roiWithPayouts, skillReport, type OverGap, type OverGapStatus, type SkillItem, type SkillReport } from "@/lib/analysis/marketSkill";
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
    // A forecast made, or quoted, after kickoff is not a forecast. A backfill row
    // with no recorded quote time (stored before 2026-10-20) is kept and
    // labelled: it can't be checked either way.
    const madeAt = filter.source === "live" ? r.createdAt : r.quotedAt;
    if (p.gameStartTime && madeAt && madeAt > p.gameStartTime) continue;
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
      ...(madeAt ? {} : { quoteTimeUnknown: true }),
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
export async function overGapRows(
  modelVersions: string[],
  opts: { reps?: number; withStatus?: boolean } = {},
): Promise<(OverGapRow & { status?: OverGapStatus })[]> {
  const samples: [string, Parameters<typeof loadSkillItems>[0]][] = [
    ["Underdog lines — graded history", { source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0, lineKind: "venue" }],
    ["PrizePicks lines — graded history", { source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0, lineKind: "prizepicks" }],
    ...modelVersions.map((v): [string, Parameters<typeof loadSkillItems>[0]] => [
      `Underdog lines — live forecasts, model ${v}`,
      { source: "live", marketMethod: "consensus-v2", modelVersion: v, lineKind: "venue" },
    ]),
  ];
  const rows: (OverGapRow & { status?: OverGapStatus })[] = [];
  for (const [label, filter] of samples) {
    const items = await loadSkillItems(filter);
    rows.push({ label, gap: overGap(items, opts), ...(opts.withStatus ? { status: overGapStatus(items, opts) } : {}) });
  }
  return rows;
}
