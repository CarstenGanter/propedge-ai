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
 *
 * Gate (stated before running): the fitted spread ships only if its held-out
 * log-loss is lower with the 95% game-bootstrap interval of the difference
 * below zero, and its calibration error is no worse.
 */
import { prisma } from "@/lib/db/client";
import { parseSnapshot } from "@/lib/marketSnapshot";
import { buildConsensus, consensusSideProb, pricedAt, type RawQuote } from "@/lib/analysis/marketConsensus";
import { FITTED_SPREAD, FITTED_SPREAD_PARAMS } from "@/lib/analysis/consensusSpread";
import { clusterBootstrap } from "@/lib/analysis/marketSkill";
import { calibrationSummary, excessByVenueGap, reliabilityTable, type BucketRow, type VenueItem } from "@/lib/analysis/venueCalibration";

const FIT_WEEK_START = "2026-10-15";

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

function report(title: string, pairs: Pair[], gate: boolean) {
  console.log(`\n=== ${title} ===`);
  if (pairs.length === 0) return console.log("  no props");
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
    const mOld = buildConsensus(p.propType, quotes).model;
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
  report(`PRIMARY — held-out weeks (before ${FIT_WEEK_START})`, pairs.filter((p) => p.date < FIT_WEEK_START), true);
  report(`SECONDARY — the fit week (its prices fitted σ; its outcomes did not)`, pairs.filter((p) => p.date >= FIT_WEEK_START), false);
  await prisma.$disconnect();
}

main();
