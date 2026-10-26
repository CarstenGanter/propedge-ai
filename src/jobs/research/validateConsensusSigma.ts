/**
 * The σ task, step 2: does the ladder-fitted spread read the books better at
 * venue lines, on graded outcomes, in weeks the fit never saw?
 *
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/research/validateConsensusSigma.ts
 *
 * For every graded consensus-v2 prop of a fitted prop type with an Underdog or
 * PrizePicks line, the books' P(over) at that line under the current spread and
 * the fitted one (push-conditioned at whole-number lines; pushes dropped).
 * Primary result: held-out weeks — before the fit's slate week (2026-10-15).
 * The fit week, which holds the alternate-line props behind the 85% reading,
 * is reported separately: its prices were used to fit, its outcomes were not.
 * Weeks after it (2026-10-20 on) are reported apart again: neither their
 * prices nor their outcomes were seen by the fit.
 *
 * Revert rule (decided 2026-10-20): one pooled sample — the held-out weeks
 * plus the weeks after the fit week, never the fit week itself. Revert only if
 * its log-loss interval sits clearly above zero. The separate samples are for
 * information and trigger nothing.
 *
 * Gate (stated before running): the fitted spread ships only if its held-out
 * log-loss is lower with the 95% game-bootstrap interval of the difference
 * below zero, and its calibration error is no worse.
 */
import { prisma } from "@/lib/db/client";
import { parseSnapshot } from "@/lib/marketSnapshot";
import { buildConsensus, consensusSideProb, pricedAt, type RawQuote } from "@/lib/analysis/marketConsensus";
import { CV_PRIOR_SPREAD, FITTED_SPREAD, heldOutPriceTest } from "@/lib/analysis/consensusSpread";
import { FIT_LADDER_DAY, loadLadders } from "./ladders";
import { FITTED_SPREAD_PARAMS } from "@/lib/analysis/marketConsensus";
import { clusterBootstrap } from "@/lib/analysis/marketSkill";
import { calibrationSummary, excessByVenueGap, reliabilityTable, type BucketRow, type VenueItem } from "@/lib/analysis/venueCalibration";
import { emitSummary } from "@/lib/jobSummary";
import type { SigmaSample } from "@/lib/weeklySummary";

/** The fit's slate week: Thursday 2026-10-15 through Monday 2026-10-19 (Eastern slate dates). */
const FIT_WEEK_START = "2026-10-15";
const FIT_WEEK_END = "2026-10-20";

interface Pair {
  old: VenueItem;
  fit: VenueItem;
  venue: "underdog" | "prizepicks";
  date: string;
}

function ll(p: number, hit: boolean) {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return -Math.log(hit ? q : 1 - q);
}

function printBuckets(title: string, rows: BucketRow[]) {
  console.log(`  ${title}`);
  for (const r of rows) {
    const iv = r.excessInterval ? `[${r.excessInterval.lo.toFixed(1)}, ${r.excessInterval.hi.toFixed(1)}]` : "";
    console.log(`    ${r.label.padEnd(24)} n=${String(r.n).padStart(4)}  books ${r.predictedPts.toFixed(1).padStart(5)}  actual ${r.actualPts.toFixed(1).padStart(5)}  hits−expected ${r.excessPts.toFixed(1).padStart(6)} ${iv}`);
  }
}

function report(sample: SigmaSample["sample"], title: string, pairs: Pair[], gate: boolean): SigmaSample {
  console.log(`\n=== ${title} ===`);
  if (pairs.length === 0) {
    console.log("  no props");
    return { sample, n: 0, games: 0, diff: null, interval: null, eceCurrent: null, eceFitted: null, gate: null };
  }
  const old = pairs.map((p) => p.old);
  const fit = pairs.map((p) => p.fit);
  const co = calibrationSummary(old)!;
  const cf = calibrationSummary(fit)!;
  console.log(`  venue lines ${co.n} (Underdog ${pairs.filter((p) => p.venue === "underdog").length}, PrizePicks ${pairs.filter((p) => p.venue === "prizepicks").length}), games ${co.games}`);
  console.log(`  current spread  log-loss ${co.logLoss.toFixed(4)}  Brier ${co.brier.toFixed(4)}  ECE ${co.ecePts.toFixed(2)} pts`);
  console.log(`  fitted spread   log-loss ${cf.logLoss.toFixed(4)}  Brier ${cf.brier.toFixed(4)}  ECE ${cf.ecePts.toFixed(2)} pts`);
  const diffItems = pairs.map((p) => ({ cluster: p.old.cluster, d: ll(p.fit.p, p.fit.hit) - ll(p.old.p, p.old.hit) }));
  const mean = (xs: typeof diffItems) => xs.reduce((s, x) => s + x.d, 0) / xs.length;
  const iv = clusterBootstrap(diffItems, (xs) => (xs.length ? mean(xs) : null));
  console.log(`  log-loss difference (fitted − current) ${mean(diffItems).toFixed(5)}` + (iv ? `  95% game-bootstrap [${iv.lo.toFixed(5)}, ${iv.hi.toFixed(5)}]` : ""));
  const differing = pairs.filter((p) => Math.abs(p.old.p - p.fit.p) > 1e-4);
  if (differing.length) {
    const d = differing.map((p) => ({ cluster: p.old.cluster, d: ll(p.fit.p, p.fit.hit) - ll(p.old.p, p.old.hit) }));
    const div = clusterBootstrap(d, (xs) => (xs.length ? mean(xs) : null));
    console.log(`  …on the ${differing.length} lines where the two spreads differ: ${mean(d).toFixed(5)}` + (div ? ` [${div.lo.toFixed(5)}, ${div.hi.toFixed(5)}]` : ""));
  }
  printBuckets("reliability of P(over), current spread", reliabilityTable(old));
  printBuckets("reliability of P(over), fitted spread", reliabilityTable(fit));
  printBuckets("hits − expected by venue gap (stat units, + = easier Over), current", excessByVenueGap(old));
  printBuckets("hits − expected by venue gap, fitted", excessByVenueGap(fit));
  if (gate) {
    const pass = iv != null && iv.hi < 0 && cf.ecePts <= co.ecePts;
    console.log(`\n  GATE: ${pass ? "PASS" : "FAIL"} — log-loss interval ${iv ? `[${iv.lo.toFixed(5)}, ${iv.hi.toFixed(5)}]` : "n/a"} must sit below 0; ECE ${cf.ecePts.toFixed(2)} vs ${co.ecePts.toFixed(2)} must not be worse.`);
  }
  return {
    sample,
    n: co.n,
    games: co.games,
    diff: mean(diffItems),
    interval: iv,
    eceCurrent: co.ecePts,
    eceFitted: cf.ecePts,
    gate: gate ? (iv != null && iv.hi < 0 && cf.ecePts <= co.ecePts ? "PASS" : "FAIL") : null,
  };
}

async function main() {
  const types = Object.keys(FITTED_SPREAD_PARAMS);
  const props = await prisma.playerProp.findMany({
    where: { sport: "NFL", isDemo: false, propType: { in: types }, actualResult: { not: null }, date: { gte: "2026-10-01" } },
  });
  const pairs: Pair[] = [];
  for (const p of props) {
    const snap = parseSnapshot(p.marketDataJson);
    if (!snap?.quotes?.length) continue;
    const quotes: RawQuote[] = snap.quotes.map((q) => ({ book: q.book, line: q.line, over: q.over, under: q.under, lastUpdate: q.lastUpdate }));
    const mOld = buildConsensus(p.propType, quotes, { spread: CV_PRIOR_SPREAD }).model;
    const mFit = buildConsensus(p.propType, quotes, { spread: FITTED_SPREAD }).model;
    if (!mOld || !mFit) continue;
    const venues: [Pair["venue"], number | null | undefined][] = [
      ["underdog", p.underdogLine],
      ["prizepicks", snap.venues?.prizepicks],
    ];
    for (const [venue, line] of venues) {
      if (line == null || p.actualResult === line) continue;
      const over = p.actualResult! > line;
      const cluster = `${p.date}|${p.team}|${p.opponent}`;
      const gap = mOld.referenceLine - line;
      const priced = pricedAt(mOld, line);
      pairs.push({
        venue,
        date: p.date,
        old: { p: consensusSideProb(mOld, line, "OVER"), hit: over, cluster, gap, priced },
        fit: { p: consensusSideProb(mFit, line, "OVER"), hit: over, cluster, gap, priced },
      });
    }
  }
  console.log(`Fitted prop types: ${types.join(", ")}. Fit-week start ${FIT_WEEK_START}.`);
  const samples = [
    report("held-out", `PRIMARY — held-out weeks (before ${FIT_WEEK_START})`, pairs.filter((p) => p.date < FIT_WEEK_START), true),
    report("fit-week", `SECONDARY — the fit week (its prices fitted σ; its outcomes did not)`, pairs.filter((p) => p.date >= FIT_WEEK_START && p.date < FIT_WEEK_END), false),
    report("after-fit", `AFTER — weeks from ${FIT_WEEK_END} (prices and outcomes both unseen by the fit)`, pairs.filter((p) => p.date >= FIT_WEEK_END), false),
    report(
      "pooled",
      `POOLED — held-out + after-fit weeks, never the fit week (the revert rule's sample: revert only if this interval sits above zero)`,
      pairs.filter((p) => p.date < FIT_WEEK_START || p.date >= FIT_WEEK_END),
      false,
    ),
  ];
  emitSummary("sigma", { types, samples });

  // The held-out price test (decided 2026-10-21): the shipped spread vs the
  // current one on ladders the fit never saw. Keep only if the error
  // difference's interval sits below zero; otherwise revert.
  const { ladders } = await loadLadders();
  // Only prop types the shipped spread was fitted on: rushing-yards ladders
  // (from 2026-11-01) are for their own fit, and would read as a tie here.
  const heldOut = ladders.filter((l) => l.day > FIT_LADDER_DAY && l.propType in FITTED_SPREAD_PARAMS);
  const price = heldOutPriceTest(heldOut, FITTED_SPREAD, CV_PRIOR_SPREAD);
  console.log(`\n=== HELD-OUT PRICE TEST — ladders fetched after ${FIT_LADDER_DAY} (the fit's own day) ===`);
  if (price.ladders === 0) console.log("  no held-out ladders yet: the next slate fetch buys them (receiving yards, ~13 credits)");
  else {
    console.log(`  ${price.ladders} ladders, ${price.rungs} rungs, ${price.games} games | RMSE current ${price.rmseCurrent!.toFixed(2)} pts, fitted ${price.rmseFitted!.toFixed(2)} pts`);
    console.log(`  squared-error difference (fitted − current) ${price.diff!.toFixed(2)} pts²` + (price.interval ? `  95% game-bootstrap [${price.interval.lo.toFixed(2)}, ${price.interval.hi.toFixed(2)}]` : ""));
    console.log(
      price.verdict === "pending"
        ? `  VERDICT: pending — ${price.games} game; the interval resamples by game and needs at least 2`
        : `  VERDICT: ${price.verdict} — keep only if the interval sits below zero`,
    );
  }
  emitSummary("sigmaPrice", { fitDay: FIT_LADDER_DAY, ...price });
  await prisma.$disconnect();
}

main();
