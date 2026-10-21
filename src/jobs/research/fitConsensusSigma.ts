/**
 * The σ task, step 1: fit the consensus spread to the books' alternate ladders.
 *
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/research/fitConsensusSigma.ts
 *
 * For every player with an alternate ladder in the odds store, the main-line
 * quotes come from the store's slate quotes as of the ladder's fetch (ladders.ts),
 * each book's one-sided alternates are de-vigged with its own main-line power
 * exponent, and σ = a + b × line is grid-searched per prop type to minimise the
 * squared error between the consensus's P(over) and the ladder's at every rung.
 * Only prices are used — no outcomes — so the weeks whose outcomes validate the
 * fit stay untouched.
 */
import { prisma } from "@/lib/db/client";
import { buildConsensus, consensusProbOver, type ConsensusSpread } from "@/lib/analysis/marketConsensus";
import { affineSpread, CV_PRIOR_SPREAD, fitAffineSigma, type Ladder } from "@/lib/analysis/consensusSpread";
import { loadLadders } from "./ladders";

function rmsePts(ladders: Ladder[], spread: ConsensusSpread, bucket?: (d: number) => boolean) {
  let sse = 0;
  let n = 0;
  for (const l of ladders) {
    const m = buildConsensus(l.propType, l.main, { spread }).model;
    if (!m) continue;
    for (const r of l.rungs) {
      if (bucket && !bucket(Math.abs(r.line - m.referenceLine))) continue;
      sse += (consensusProbOver(m, r.line) - r.pOver) ** 2;
      n++;
    }
  }
  return { n, rmse: n ? Math.sqrt(sse / n) * 100 : NaN };
}

async function main() {
  const { ladders, noMain } = await loadLadders();
  const types = [...new Set(ladders.map((l) => l.propType))];
  console.log(`ladders ${ladders.length} (no main quotes for ${noMain}); rungs ${ladders.reduce((s, l) => s + l.rungs.length, 0)}; prop types: ${types.join(", ")}`);
  const params: Record<string, { a: number; b: number }> = {};
  for (const t of types) {
    const fit = fitAffineSigma(t, ladders);
    params[t] = { a: fit.a, b: fit.b };
    console.log(`\n${t}: σ = ${fit.a} + ${fit.b} × line   (${fit.ladders} ladders, ${fit.rungs} rungs)`);
  }
  const fitted = affineSpread(params);
  const buckets: [string, (d: number) => boolean][] = [
    ["all rungs", () => true],
    ["within 5 of the main line", (d) => d <= 5],
    ["5–10 away", (d) => d > 5 && d <= 10],
    ["10–20 away", (d) => d > 10 && d <= 20],
    ["over 20 away", (d) => d > 20],
  ];
  console.log("\nRMSE vs the de-vigged ladder, probability points  (current = CV prior × line, damped 0.7)");
  for (const [label, f] of buckets) {
    const cur = rmsePts(ladders, CV_PRIOR_SPREAD, f);
    const fit = rmsePts(ladders, fitted, f);
    console.log(`  ${label.padEnd(26)} n=${String(cur.n).padStart(5)}   current ${cur.rmse.toFixed(2).padStart(6)}   fitted ${fit.rmse.toFixed(2).padStart(6)}`);
  }
  console.log(`\nFITTED_SPREAD_PARAMS = ${JSON.stringify(params)}`);

  // The held-out price test of what ships (FITTED_SPREAD_PARAMS) runs in
  // research:sigma-validate, on ladders fetched after the fit's own day.
  console.log(`\nFit ladders by day: ${[...new Set(ladders.map((l) => l.day))].sort().join(", ")}. Held-out price test: npm run research:sigma-validate.`);
  await prisma.$disconnect();
}

main();
