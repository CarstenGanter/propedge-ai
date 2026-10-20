/**
 * Task 1: score the model against the market on every settled NFL prop.
 *
 *   npm run research:skill            (needs network for nflverse; no Odds API credits)
 *
 * 1. Grades every stored NFL prop whose game is over from nflverse weekly stats
 *    and snap counts (gradeProps.ts), filling PlayerProp.actualResult where
 *    settlement left it empty. Existing results are never overwritten;
 *    disagreements with them are reported.
 * 2. Backfills "baseline-v0 (nflverse logs, no context)": estimateProbability
 *    run walk-forward — each prop sees only the player's games from weeks before
 *    its own, assembled the way the live ESPN path assembles them — with the
 *    stored consensus as the market input and no context adjustments, which
 *    were never stored for non-pick props. It is a baseline, not the live model.
 * 3. Prints log-loss skill vs the de-vigged consensus with game-clustered
 *    bootstrap intervals: consensus-v2 props (per-book quotes, 2026-10-01 on)
 *    as the primary result, novig-v1 props as a separate secondary table, live
 *    rows separately again. Never pooled.
 */
import zlib from "node:zlib";
import { prisma } from "@/lib/db/client";
import { parseCsv } from "@/lib/utils/csv";
import { nflverseCode } from "@/lib/nfl/teamCodes";
import { GRADABLE_PROPS, gradeProp, parseGradingStats, priorGames, type Appearance, type SeasonData } from "@/lib/nfl/gradeProps";
import { estimateProbability } from "@/lib/analysis/probabilityModel";
import { consensusProbOver } from "@/lib/analysis/marketConsensus";
import { consensusOf, parseSnapshot } from "@/lib/marketSnapshot";
import { BASELINE_V0, marketMethodOf, overProb } from "@/lib/predictionLog";
import { liveModelVersions, loadSkillItems, payoutRoi, skillSection, type SkillSection } from "@/lib/predictionReport";
import { skillBy, type SkillBreakdown } from "@/lib/analysis/marketSkill";
import type { Prisma } from "@prisma/client";

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";
const SEASON = 2026;

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return url.endsWith(".gz") ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

async function loadSeason(season: number, pfrToGsis: Map<string, string>): Promise<SeasonData> {
  const [weekly, snaps] = await Promise.all([
    fetchCsv(`${BASE}/stats_player/stats_player_week_${season}.csv.gz`),
    fetchCsv(`${BASE}/snap_counts/snap_counts_${season}.csv.gz`),
  ]);
  const rows = parseGradingStats(weekly);
  // A snap-count player without a players.csv link is tied to a stat row by name and team.
  const byNameTeam = new Map(rows.map((r) => [`${r.name}|${r.team}`, r.gsisId]));
  const appearances: Appearance[] = [];
  for (const r of parseCsv(snaps).rows) {
    if (r.game_type && r.game_type !== "REG" && r.game_type !== "POST") continue;
    if (!(Number(r.offense_snaps) > 0)) continue;
    const gsisId = pfrToGsis.get(r.pfr_player_id) ?? byNameTeam.get(`${r.player}|${r.team}`) ?? `pfr:${r.pfr_player_id}`;
    appearances.push({ gsisId, name: r.player, week: Number(r.week), team: r.team });
  }
  return { rows, appearances };
}

function pct(x: number | undefined | null, d = 1) {
  return x == null || !Number.isFinite(x) ? "  —  " : `${(x * 100).toFixed(d)}%`;
}

function printBreakdown(title: string, rows: SkillBreakdown[]) {
  console.log(`  ${title}`);
  for (const r of rows) {
    const iv = r.interval ? `[${pct(r.interval.lo)}, ${pct(r.interval.hi)}]` : "";
    console.log(`    ${r.key.padEnd(16)} n=${String(r.score.n).padStart(4)} games=${String(r.score.games).padStart(3)}  skill ${pct(r.score.skill, 2).padStart(7)} ${iv}`);
  }
}

function printSection(s: SkillSection) {
  console.log(`\n=== ${s.title} ===\n  ${s.note}`);
  const r = s.report;
  if (!r?.overall) {
    console.log("  no scored props yet");
    return;
  }
  const o = r.overall;
  console.log(
    `  props ${o.n}, games ${o.games} | log-loss model ${o.llModel.toFixed(4)}, market ${o.llMarket.toFixed(4)} | ` +
      `skill vs market ${pct(o.skill, 2)}` + (r.interval ? ` (95% game-bootstrap ${pct(r.interval.lo, 2)} to ${pct(r.interval.hi, 2)})` : ""),
  );
  printBreakdown("by prop type", r.byPropType);
  printBreakdown("by the side the model leans vs the market", r.byLean);
  console.log("  edge buckets (claimed edge, pts → hits minus market-expected hits, pts per prop)");
  for (const b of r.buckets) {
    const iv = b.excessInterval ? `[${b.excessInterval.lo.toFixed(1)}, ${b.excessInterval.hi.toFixed(1)}]` : "";
    console.log(`    ${b.label.padEnd(5)} n=${String(b.n).padStart(4)} claimed ${b.meanClaimedPts.toFixed(1).padStart(5)}  excess ${b.excessPts.toFixed(1).padStart(6)} ${iv}`);
  }
  printBreakdown("by edge source", r.byEdgeSource);
}

async function main() {
  console.log("Loading nflverse…");
  const players = parseCsv(await fetchCsv(`${BASE}/players/players.csv`)).rows;
  const pfrToGsis = new Map(players.filter((p) => p.pfr_id && p.gsis_id).map((p) => [p.pfr_id, p.gsis_id]));
  const [current, prior] = await Promise.all([loadSeason(SEASON, pfrToGsis), loadSeason(SEASON - 1, pfrToGsis)]);

  const now = Date.now();
  const props = await prisma.playerProp.findMany({
    where: { sport: "NFL", isDemo: false, propType: { in: [...GRADABLE_PROPS] }, gameStartTime: { lt: new Date(now) } },
  });

  const tally = { graded: 0, snapsOnly: 0, void: 0, unmatched: 0, pending: 0, filled: 0, noGames: 0, noMarket: 0 };
  const mismatches: string[] = [];
  const fills: { id: string; value: number }[] = [];
  const forecasts: Prisma.PropPredictionCreateManyInput[] = [];

  for (const p of props) {
    const home = nflverseCode(p.team);
    const away = nflverseCode(p.opponent);
    if (!home || !away) {
      tally.unmatched++;
      continue;
    }
    const g = gradeProp({ playerName: p.playerName, propType: p.propType, home, away }, current);
    if (g.kind === "pending") { tally.pending++; continue; }
    if (g.kind === "unmatched") { tally.unmatched++; continue; }
    if (g.kind === "void") { tally.void++; continue; }
    tally.graded++;
    if (g.fromSnapsOnly) tally.snapsOnly++;
    if (p.actualResult == null) fills.push({ id: p.id, value: g.value });
    else if (Math.abs(p.actualResult - g.value) > 1e-9) mismatches.push(`${p.date} ${p.playerName} ${p.propType}: stored ${p.actualResult}, nflverse ${g.value}`);

    // --- baseline-v0 forecast at the books' own line ---
    const snapshot = parseSnapshot(p.marketDataJson);
    const method = marketMethodOf(snapshot);
    let line: number | null = null;
    let marketOver: number | null = null;
    if (method === "consensus-v2") {
      const m = consensusOf(snapshot);
      if (m) {
        line = m.referenceLine;
        marketOver = consensusProbOver(m, line);
      }
    } else if (snapshot?.noVigProbOver != null) {
      line = snapshot.marketLine ?? p.line;
      marketOver = snapshot.noVigProbOver;
    }
    if (line == null || marketOver == null) { tally.noMarket++; continue; }
    const games = priorGames(g.gsisId, p.propType, g.week, current, prior);
    // The live path takes the side the books favour at the line it scores.
    const direction = marketOver >= 0.5 ? "OVER" : "UNDER";
    const est = estimateProbability({ line, direction, propType: p.propType, games, marketProbOver: marketOver, marketLine: line, adjustments: [] });
    if (!est) { tally.noGames++; continue; }
    const fetched = snapshot?.fetchedAt ? new Date(snapshot.fetchedAt) : p.updatedAt;
    forecasts.push({
      playerPropId: p.id,
      quotedAt: p.gameStartTime && fetched > p.gameStartTime ? p.gameStartTime : fetched,
      line,
      lineKind: "reference",
      modelProbOver: overProb(est.probability, direction),
      modelRawProbOver: overProb(est.rawProbability, direction),
      marketProbOver: marketOver,
      marketMethod: method,
      modelVersion: BASELINE_V0,
      source: "backfill",
      edgeSource: "unknown",
    });
  }

  for (const f of fills) await prisma.playerProp.update({ where: { id: f.id }, data: { actualResult: f.value } });
  tally.filled = fills.length;
  await prisma.propPrediction.deleteMany({ where: { source: "backfill", modelVersion: BASELINE_V0 } });
  await prisma.propPrediction.createMany({ data: forecasts });

  console.log(`\nGrading: ${JSON.stringify(tally)}`);
  console.log(`Results filled where empty: ${tally.filled}. Disagreements with stored results: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 15)) console.log(`  ${m}`);
  console.log(`baseline-v0 forecasts written: ${forecasts.length}`);

  const primary = await skillSection(
    `PRIMARY — ${BASELINE_V0}, consensus-v2 market (2026-10-01 on)`,
    "Model and market read at the books' own line. Walk-forward: each prop uses only earlier weeks.",
    { source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0 },
  );
  printSection(primary);
  const byDate = skillBy(await loadSkillItems({ source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0 }), (i) => i.date ?? null);
  printBreakdown("by slate (each slate held out: nothing is fitted)", byDate.sort((a, b) => a.key.localeCompare(b.key)));

  printSection(
    await skillSection(
      `SECONDARY — ${BASELINE_V0}, novig-v1 market (before 2026-10-01)`,
      "A different market method (one stored no-vig probability). Never pooled with the primary result.",
      { source: "backfill", marketMethod: "novig-v1", modelVersion: BASELINE_V0 },
    ),
  );

  for (const v of await liveModelVersions()) {
    printSection(
      await skillSection(`LIVE — model ${v}, consensus-v2`, "Logged at scoring time, at the line played.", { source: "live", marketMethod: "consensus-v2", modelVersion: v }),
    );
  }

  const roi = await payoutRoi();
  console.log(`\nROI on settled picks with Underdog's payout entered: ${roi ? `${pct(roi.roi)} over ${roi.n} picks` : "none"}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
