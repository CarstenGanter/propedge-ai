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
 * 4. Diagnostics, no probability changes:
 *    - player layer: the model with market weight 0 scored against the market,
 *      and outcome ~ logit(p_market) + logit(p_model) on the primary sample;
 *    - books at the venue line: reliability of the books' P(over) read at every
 *      Underdog and PrizePicks line (current σ method) — the σ task's baseline.
 *      Those P(over)s are stored too, as backfill rows with lineKind "venue"
 *      (Underdog) and "prizepicks", never pooled with the reference-line result.
 */
import { prisma } from "@/lib/db/client";
import { parseCsv } from "@/lib/utils/csv";
import { nflverseCode } from "@/lib/nfl/teamCodes";
import { GRADABLE_PROPS, gradeProp, priorGames } from "@/lib/nfl/gradeProps";
import { aliasFor } from "@/lib/nfl/playerAliases";
import { BASE, fetchCsv, loadSeason } from "@/lib/nfl/nflverseSeasons";
import { resolveEspnAthlete } from "@/lib/providers/live/espnPlayerStats";
import { estimateProbability } from "@/lib/analysis/probabilityModel";
import { consensusProbOver, consensusSideProb, pricedAt } from "@/lib/analysis/marketConsensus";
import { consensusOf, parseSnapshot } from "@/lib/marketSnapshot";
import { BASELINE_V0, marketMethodOf, overProb } from "@/lib/predictionLog";
import { emitSummary } from "@/lib/jobSummary";
import { liveModelVersions, loadSkillItems, payoutRoi, skillSection, type SkillSection } from "@/lib/predictionReport";
import { clusterBootstrap, skillBy, skillScore, stackingFit, type SkillBreakdown, type SkillItem } from "@/lib/analysis/marketSkill";
import { calibrationSummary, excessByVenueGap, reliabilityTable, type BucketRow, type VenueItem } from "@/lib/analysis/venueCalibration";

import type { Prisma } from "@prisma/client";

const SEASON = 2026;


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

function printPlayerLayer(items: SkillItem[]) {
  console.log("\n=== DIAGNOSTIC — player layer (market weight 0), primary sample ===");
  console.log("  The model on the player's own sample only, unclipped, vs the de-vigged consensus at the books' line.");
  const s = skillScore(items);
  if (!s) return console.log("  no props");
  const iv = clusterBootstrap(items, (x) => skillScore(x)?.skill ?? null);
  console.log(
    `  props ${s.n}, games ${s.games} | log-loss player layer ${s.llModel.toFixed(4)}, market ${s.llMarket.toFixed(4)} | ` +
      `skill ${pct(s.skill, 2)}` + (iv ? ` (95% ${pct(iv.lo, 2)} to ${pct(iv.hi, 2)})` : ""),
  );
  const st = stackingFit(items);
  if (!st) return console.log("  stacking fit did not converge");
  const names = ["intercept", "logit(p_market)", "logit(p_model)"];
  console.log("  stacking: outcome ~ logit(p_market) + logit(p_model)  (game-bootstrap 95%)");
  st.coef.forEach((c, k) => {
    const ci = st.intervals?.[k];
    console.log(`    ${names[k].padEnd(16)} ${c.toFixed(3).padStart(7)}  ${ci ? `[${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]` : ""}`);
  });
}

function printBuckets(rows: BucketRow[]) {
  for (const r of rows) {
    const iv = r.excessInterval ? `[${r.excessInterval.lo.toFixed(1)}, ${r.excessInterval.hi.toFixed(1)}]` : "";
    console.log(
      `    ${r.label.padEnd(24)} n=${String(r.n).padStart(4)}  books ${r.predictedPts.toFixed(1).padStart(5)}  actual ${r.actualPts.toFixed(1).padStart(5)}  hits−expected ${r.excessPts.toFixed(1).padStart(6)} ${iv}`,
    );
  }
}

function printVenueCalibration(items: VenueItem[], skippedOldMethod: number) {
  console.log("\n=== DIAGNOSTIC — books' P(over) at the Underdog and PrizePicks lines (current σ method): the σ-task baseline ===");
  console.log(`  Every graded consensus-v2 prop with a venue line, as P(over). (${skippedOldMethod} older-method venue lines left out.)`);
  for (const [label, xs] of [
    ["all", items],
    ["Underdog lines", items.filter((i) => i.venue === "venue")],
    ["PrizePicks lines", items.filter((i) => i.venue === "prizepicks")],
    ["priced (within a point of the books' lines)", items.filter((i) => i.priced)],
    ["beyond the books' lines", items.filter((i) => !i.priced)],
  ] as const) {
    const c = calibrationSummary([...xs]);
    if (c) console.log(`  ${label.padEnd(44)} n=${String(c.n).padStart(4)} games=${String(c.games).padStart(3)}  log-loss ${c.logLoss.toFixed(4)}  Brier ${c.brier.toFixed(4)}  ECE ${c.ecePts.toFixed(1)} pts`);
  }
  console.log("  reliability, 5-point bins of the books' probability");
  printBuckets(reliabilityTable(items));
  console.log("  hits minus books-expected hits, by venue gap (stat units, + = easier Over)");
  printBuckets(excessByVenueGap(items));
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

  // Props scored before ESPN ids were stored get one now, from ESPN team rosters (free, cached).
  let idsResolved = 0;
  for (const p of props) {
    if (p.espnAthleteId) continue;
    const ref = await resolveEspnAthlete("NFL", p.playerName, p.team, p.opponent);
    if (!ref) continue;
    await prisma.playerProp.update({ where: { id: p.id }, data: { espnAthleteId: ref.athleteId } });
    p.espnAthleteId = ref.athleteId;
    idsResolved++;
  }

  const tally = { graded: 0, byId: 0, byName: 0, byAlias: 0, snapsOnly: 0, void: 0, unmatched: 0, pending: 0, filled: 0, noGames: 0, noMarket: 0 };
  const mismatches: string[] = [];
  const unmatched: { label: string; reason: string }[] = [];
  const voided: string[] = [];
  const playerLayer: SkillItem[] = [];
  const venue: VenueItem[] = [];
  let venueSkippedOldMethod = 0;
  const fills: { id: string; value: number }[] = [];
  const forecasts: Prisma.PropPredictionCreateManyInput[] = [];

  for (const p of props) {
    const home = nflverseCode(p.team);
    const away = nflverseCode(p.opponent);
    const label = `${p.date} ${p.playerName} — ${p.propType} (${p.opponent} @ ${p.team})`;
    if (!home || !away) {
      tally.unmatched++;
      unmatched.push({ label, reason: "team name has no nflverse code" });
      continue;
    }
    // Feed names nflverse doesn't know get one more try under an approved alias (playerAliases.ts).
    const g = gradeProp({ playerName: p.playerName, espnId: p.espnAthleteId, propType: p.propType, home, away, date: p.date, espnGameId: p.gameId }, current, { alias: aliasFor });
    if (g.kind === "pending") { tally.pending++; continue; }
    if (g.kind === "unmatched") {
      tally.unmatched++;
      unmatched.push({ label, reason: g.reason });
      continue;
    }
    if (g.kind === "void") { tally.void++; voided.push(`${label}: ${g.reason} [by ${g.matchedBy}]`); continue; }
    tally.graded++;
    if (g.matchedBy === "id") tally.byId++;
    else if (g.matchedBy === "alias") tally.byAlias++;
    else tally.byName++;
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
    // The quote time as recorded, or null: snapshots stored before 2026-10-20
    // carry no fetch time, and these rows are labelled "quote time unknown"
    // rather than clamped to kickoff (which only pretended to check them).
    const quotedAt = snapshot?.fetchedAt ? new Date(snapshot.fetchedAt) : null;
    const cluster = `${p.date}|${p.team}|${p.opponent}`;

    if (method === "consensus-v2" && g.value !== line) {
      // Player layer: the same model with market weight 0 — the player's own sample only.
      const solo = estimateProbability({ line, direction: "OVER", propType: p.propType, games, adjustments: [] });
      if (solo) playerLayer.push({ pModel: solo.rawProbability, pMarket: marketOver, over: g.value > line, cluster, propType: p.propType });
    }

    // Books at the venue lines, as P(over) for every prop — not just the side
    // the books favour, which bunched the table at 50–55%. Current σ method.
    const venueLines: [string, number | null | undefined][] = [
      ["venue", p.underdogLine],
      ["prizepicks", snapshot?.venues?.prizepicks],
    ];
    for (const [lineKind, vLine] of venueLines) {
      if (vLine == null || g.value === vLine) continue;
      const m = method === "consensus-v2" ? consensusOf(snapshot) : null;
      if (!m) {
        venueSkippedOldMethod++;
        continue;
      }
      const pOverVenue = consensusSideProb(m, vLine, "OVER");
      venue.push({ p: pOverVenue, hit: g.value > vLine, cluster, gap: m.referenceLine - vLine, priced: pricedAt(m, vLine), venue: lineKind });
      const vDir = pOverVenue >= 0.5 ? "OVER" : "UNDER";
      const vEst = estimateProbability({ line: vLine, direction: vDir, propType: p.propType, games, marketProbOver: marketOver, marketLine: line, adjustments: [] });
      if (vEst) {
        forecasts.push({
          playerPropId: p.id,
          quotedAt,
          line: vLine,
          lineKind,
          modelProbOver: overProb(vEst.probability, vDir),
          modelRawProbOver: overProb(vEst.rawProbability, vDir),
          marketProbOver: pOverVenue,
          marketMethod: method,
          modelVersion: BASELINE_V0,
          source: "backfill",
          edgeSource: "unknown",
        });
      }
    }
    forecasts.push({
      playerPropId: p.id,
      quotedAt,
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

  console.log(`\nESPN ids resolved for props that had none: ${idsResolved}`);
  console.log(`Grading: ${JSON.stringify(tally)}`);
  console.log(`Results filled where empty: ${tally.filled}. Disagreements with stored results: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 15)) console.log(`  ${m}`);
  console.log(`baseline-v0 forecasts written: ${forecasts.length}`);
  console.log(`\nVoided (special teams only, or rostered with no snap — never graded 0): ${voided.length}`);
  for (const v of voided) console.log(`  ${v}`);
  console.log(`\nUnmatched props: ${unmatched.length}`);
  for (const u of unmatched) console.log(`  ${u.label}: ${u.reason}`);
  emitSummary("grading", { ...tally, mismatches: mismatches.length, voided: voided.length, unmatched: unmatched.length, forecasts: forecasts.length });


  const primary = await skillSection(
    `PRIMARY — ${BASELINE_V0}, consensus-v2 market (2026-10-01 on)`,
    "Model and market read at the books' own line. Walk-forward: each prop uses only earlier weeks.",
    { source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0 },
  );
  printSection(primary);
  const primaryItems = await loadSkillItems({ source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0 });
  const unknownQuoteTime = primaryItems.filter((i) => i.quoteTimeUnknown).length;
  if (unknownQuoteTime) console.log(`  quote time unknown for ${unknownQuoteTime} of ${primaryItems.length}: their snapshots (stored before 2026-10-20) carry no fetch time, so no-lookahead can't be checked for them. Live rows are the clean measure.`);
  const byDate = skillBy(primaryItems, (i) => i.date ?? null);
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

  printPlayerLayer(playerLayer);
  printVenueCalibration(venue, venueSkippedOldMethod);

  const roi = await payoutRoi();
  console.log(`\nROI on settled picks with Underdog's payout entered: ${roi ? `${pct(roi.roi)} over ${roi.n} picks` : "none"}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
