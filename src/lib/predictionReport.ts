import "server-only";
import { prisma } from "@/lib/db/client";
import { overGap, overGapStatus, roiWithPayouts, skillReport, type OverGap, type OverGapStatus, type SkillItem, type SkillReport } from "@/lib/analysis/marketSkill";
import { BASELINE_V0, type MarketMethod } from "@/lib/predictionLog";
import { consensusOf, parseSnapshot } from "@/lib/marketSnapshot";
import { exactLineProbOver } from "@/lib/analysis/exactLine";
import { readVenueLine } from "@/lib/analysis/venues";
import { consensusAsOf } from "@/lib/analysis/quoteHistory";
import { consensusSideProb } from "@/lib/analysis/marketConsensus";
import { playedLine } from "@/lib/settlement";
import { pickByName } from "@/lib/utils/playerName";
import { teamsMatch } from "@/lib/utils/teamName";
import { type EntryPlayed, type GreenPick } from "@/lib/weeklySummary";
import { boardVerdict, STANDARD_PICK_PAYOUT, valueVerdict } from "@/lib/analysis/pickemMath";
import type { Direction } from "@/types";

export interface LoadedGreenPick extends GreenPick {
  modelVersion: string;
  /** Where the close came from: the odds store's last quote before kickoff, or the closing capture stored on the pick. */
  closeSource: "store" | "pick" | null;
}

export interface BoardPicks {
  /** Green: boardVerdict's edge. */
  green: LoadedGreenPick[];
  /** Graded picks with a books' price but no Underdog payout entered. */
  unpriced: { modelVersion: string }[];
  /** Of those, the ones that would have shown green at the standard 1.87x the board used to assume. */
  unpricedAtStandard: { modelVersion: string }[];
}

/**
 * Every graded NFL pick the board shows green (boardVerdict), with the books' P(our
 * side) at pick time — the number the rule read — and CLV at the line played.
 * The close is the odds store's last quote per book before kickoff (alternate
 * ladders left out); picks from before the store began (2026-10-22) fall back
 * to the closing capture stored on the pick, itself a pre-kickoff quote. A
 * pick with neither has no close and stays out of CLV.
 */
export async function loadBoardPicks(opts: { graded?: boolean } = {}): Promise<BoardPicks> {
  const graded = opts.graded ?? true;
  const picks = await prisma.pick.findMany({
    where: { isDemo: false, ...(graded ? { status: { in: ["hit", "miss"] } } : {}), playerProp: { sport: "NFL" } },
    include: { playerProp: true },
  });
  const out: LoadedGreenPick[] = [];
  const unpriced: BoardPicks["unpriced"] = [];
  const unpricedAtStandard: BoardPicks["unpricedAtStandard"] = [];
  for (const k of picks) {
    const pp = k.playerProp;
    const dir = pp.direction as Direction;
    const consensus = consensusOf(parseSnapshot(pp.marketDataJson));
    const read = consensus && pp.underdogLine != null ? readVenueLine(consensus, pp.underdogLine, dir) : null;
    // The books' number the board shows (serializePick's marketProb).
    const books = k.marketProb ?? (pp.underdogLine == null || pp.underdogLine === pp.line ? k.entryProb : null);
    const reliable = consensus ? consensus.reliable : null;
    const priced = read ? read.priced : null;
    const verdict = boardVerdict({ books, payout: pp.underdogPickMultiplier, reliable, priced });
    if (verdict === "unpriced") {
      unpriced.push({ modelVersion: k.modelVersion });
      if (reliable !== false && priced !== false && valueVerdict(books! * STANDARD_PICK_PAYOUT) === "edge") unpricedAtStandard.push({ modelVersion: k.modelVersion });
    }
    if (verdict !== "edge") continue;

    const line = playedLine(pp.line, pp.underdogLine);
    let close: number | null = null;
    let closeSource: LoadedGreenPick["closeSource"] = null;
    if (pp.gameStartTime) {
      const kickoff = pp.gameStartTime;
      const span = 3 * 3_600_000;
      const quotes = await prisma.oddsQuote.findMany({
        where: {
          fetchKind: { not: "alt" },
          propType: pp.propType,
          fetchedAt: { lt: kickoff },
          commenceTime: { gte: new Date(kickoff.getTime() - span), lte: new Date(kickoff.getTime() + span) },
        },
        select: { playerName: true, homeTeam: true, awayTeam: true, book: true, line: true, over: true, under: true, fetchedAt: true, bookUpdatedAt: true },
      });
      const game = quotes.filter(
        (q) => (teamsMatch(q.homeTeam, pp.team) && teamsMatch(q.awayTeam, pp.opponent)) || (teamsMatch(q.homeTeam, pp.opponent) && teamsMatch(q.awayTeam, pp.team)),
      );
      const name = pickByName([...new Set(game.map((q) => q.playerName))], pp.playerName, (n) => n);
      const m = name ? consensusAsOf(pp.propType, game.filter((q) => q.playerName === name), kickoff) : null;
      if (m) {
        close = consensusSideProb(m, line, dir);
        closeSource = "store";
      } else if (k.closingProb != null && k.closingCapturedAt && k.closingCapturedAt < kickoff) {
        close = k.closingProb;
        closeSource = "pick";
      }
    }
    const entry = k.entryProb ?? (consensus ? consensusSideProb(consensus, line, dir) : null);
    out.push({
      cluster: `${pp.date}|${pp.team}|${pp.opponent}`,
      hit: k.status === "hit",
      books: books!,
      entry: close == null ? null : entry,
      close,
      closeSource,
      modelVersion: k.modelVersion,
    });
  }
  return { green: out, unpriced, unpricedAtStandard };
}

/**
 * Real-money pick'em entries on NFL picks, by size and the multiplier paid:
 * slips from their stored multiplier, singles from payout ÷ stake where one
 * won (a lost single records no multiplier).
 */
export async function loadEntriesPlayed(): Promise<EntryPlayed[]> {
  const parlays = await prisma.parlay.findMany({
    where: { isDemo: false, placedReal: true, legs: { some: { pick: { playerProp: { sport: "NFL" } } } } },
    select: { payoutMultiplier: true, _count: { select: { legs: true } } },
  });
  const firstNfl = await prisma.pick.findFirst({ where: { isDemo: false, playerProp: { sport: "NFL" } }, orderBy: { date: "asc" }, select: { date: true } });
  const singles = firstNfl
    ? await prisma.bankrollEntry.findMany({
        where: { isDemo: false, placedReal: true, entryType: "single", status: "won", date: { gte: firstNfl.date }, stake: { gt: 0 } },
        select: { stake: true, payout: true },
      })
    : [];
  return [
    ...parlays.map((p) => ({ legs: p._count.legs, multiplier: p.payoutMultiplier })),
    ...singles.map((s) => ({ legs: 1, multiplier: s.payout / s.stake })),
  ];
}

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
  /**
   * Keep only rows whose line a sportsbook posted exactly, with the market read
   * from those books alone (exactLineProbOver) instead of the spread curve.
   * Read from the prop's stored quotes, so a live row counts only while those
   * are the quotes it was scored on.
   */
  exactLine?: boolean;
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
      playerProp: {
        select: { actualResult: true, gameStartTime: true, date: true, team: true, opponent: true, propType: true, ...(filter.exactLine ? { marketDataJson: true } : {}) },
      },
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
    let pMarket = r.marketProbOver;
    if (filter.exactLine) {
      const snap = parseSnapshot((p as { marketDataJson?: string | null }).marketDataJson ?? null);
      const sameQuotes = !r.quotedAt || !snap?.fetchedAt || Math.abs(Date.parse(snap.fetchedAt) - r.quotedAt.getTime()) < 1000;
      const exact = sameQuotes && snap?.quotes?.length ? exactLineProbOver(snap.quotes, r.line) : null;
      if (exact == null) continue;
      pMarket = exact;
    }
    items.push({
      pModel: r.modelProbOver,
      pMarket,
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
/** The Over-vs-books samples: each venue's graded history, then live Underdog rows per model version. */
export function overGapSamples(modelVersions: string[]): [string, Parameters<typeof loadSkillItems>[0]][] {
  return [
    ["Underdog lines — graded history", { source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0, lineKind: "venue" }],
    ["PrizePicks lines — graded history", { source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0, lineKind: "prizepicks" }],
    ...modelVersions.map((v): [string, Parameters<typeof loadSkillItems>[0]] => [
      `Underdog lines — live forecasts, model ${v}`,
      { source: "live", marketMethod: "consensus-v2", modelVersion: v, lineKind: "venue" },
    ]),
  ];
}

export async function overGapRows(
  modelVersions: string[],
  opts: { reps?: number; withStatus?: boolean } = {},
): Promise<(OverGapRow & { status?: OverGapStatus })[]> {
  const samples = overGapSamples(modelVersions);
  const rows: (OverGapRow & { status?: OverGapStatus })[] = [];
  for (const [label, filter] of samples) {
    const items = await loadSkillItems(filter);
    rows.push({ label, gap: overGap(items, opts), ...(opts.withStatus ? { status: overGapStatus(items, opts) } : {}) });
  }
  return rows;
}
