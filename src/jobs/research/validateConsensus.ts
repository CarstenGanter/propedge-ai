/**
 * Leave-one-book-out: does the new consensus summarise the market better than
 * the old "mean of probabilities at different lines"? Reads raw Odds API event
 * responses (JSON files) given as arguments.
 *
 *   npx tsx src/jobs/research/validateConsensus.ts event1.json [event2.json ...]
 */
import { readFileSync } from "node:fs";
import { collectQuotes, type OddsEventOdds } from "@/lib/providers/live/theOddsApi";
import { leaveOneBookOut, type HeldOut } from "@/lib/analysis/marketConsensus";
import { scoreHeldOut } from "@/lib/analysis/consensusValidation";

const files = process.argv.slice(2);
const byProp = new Map<string, { legacy: HeldOut[]; consensus: HeldOut[]; gapped: { legacy: HeldOut[]; consensus: HeldOut[] } }>();

for (const f of files) {
  const ev = JSON.parse(readFileSync(f, "utf8")) as OddsEventOdds;
  for (const e of collectQuotes(ev, "americanfootball_nfl")) {
    const bucket = byProp.get(e.propType) ?? { legacy: [], consensus: [], gapped: { legacy: [], consensus: [] } };
    const legacy = leaveOneBookOut(e.propType, e.quotes, "legacy");
    const consensus = leaveOneBookOut(e.propType, e.quotes, "consensus");
    // Keep only targets both methods predicted, so they are scored on the same set.
    const both = new Set(consensus.map((c) => c.book).filter((b) => legacy.some((l) => l.book === b)));
    const lines = e.quotes.filter((q) => q.over != null && q.under != null).map((q) => q.line);
    const disagree = new Set(lines).size > 1;
    for (const r of legacy) if (both.has(r.book)) (disagree ? bucket.gapped.legacy : bucket.legacy).push(r);
    for (const r of consensus) if (both.has(r.book)) (disagree ? bucket.gapped.consensus : bucket.consensus).push(r);
    byProp.set(e.propType, bucket);
  }
}

const fmt = (s: ReturnType<typeof scoreHeldOut>) => `n=${String(s.n).padStart(3)}  KL ${s.kl.toFixed(4)}  MAE ${s.maePts.toFixed(2)} pts`;
for (const [propType, b] of byProp) {
  console.log(`\n${propType}`);
  console.log(`  books agree on line     old: ${fmt(scoreHeldOut(b.legacy))}`);
  console.log(`                          new: ${fmt(scoreHeldOut(b.consensus))}`);
  console.log(`  books DISAGREE on line  old: ${fmt(scoreHeldOut(b.gapped.legacy))}`);
  console.log(`                          new: ${fmt(scoreHeldOut(b.gapped.consensus))}`);
}
