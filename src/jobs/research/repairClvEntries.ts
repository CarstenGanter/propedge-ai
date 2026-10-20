/**
 * One-off repair (2026-10-20): re-read each captured pick's entry probability
 * at the line its close was read at, from the quotes stored on the prop.
 *
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/research/repairClvEntries.ts [--apply]
 *
 * Until now the entry was recorded at the line scored when the board was built
 * and the close at the line played at capture time. When an Underdog line was
 * typed in between, CLV measured the line change, not market movement. The
 * prop's stored snapshot is the gameday fetch (the closing capture never
 * overwrites it), so it is the entry-time market. Dry run unless --apply.
 */
import { prisma } from "@/lib/db/client";
import { consensusOf, parseSnapshot } from "@/lib/marketSnapshot";
import { sideProbsAtLine } from "@/lib/analysis/quoteHistory";
import { playedLine } from "@/lib/settlement";
import { clvSummary } from "@/lib/analysis/modelQuality";
import type { Direction } from "@/types";

async function main() {
  const apply = process.argv.includes("--apply");
  const picks = await prisma.pick.findMany({
    where: { isDemo: false, closingProb: { not: null }, entryProb: { not: null } },
    include: { playerProp: true },
  });
  const before = clvSummary(picks.map((p) => ({ entryProb: p.entryProb!, closingProb: p.closingProb! })));
  const after: { entryProb: number; closingProb: number }[] = [];
  const changes: { id: string; entryProb: number; label: string; delta: number }[] = [];
  for (const p of picks) {
    const pp = p.playerProp;
    const m = consensusOf(parseSnapshot(pp.marketDataJson));
    const { entryProb } = sideProbsAtLine(m, null, playedLine(pp.line, pp.underdogLine), pp.direction as Direction);
    const entry = entryProb ?? p.entryProb!;
    after.push({ entryProb: entry, closingProb: p.closingProb! });
    if (entryProb != null && Math.abs(entryProb - p.entryProb!) > 1e-6) {
      changes.push({ id: p.id, entryProb, label: `${p.date} ${pp.playerName} ${pp.propType}`, delta: entryProb - p.entryProb! });
    }
  }
  const fixed = clvSummary(after);
  console.log(`picks with CLV: ${picks.length}`);
  console.log(`average CLV before: ${before.avgClv} pts (beat close ${before.beatCloseRate}%)`);
  console.log(`average CLV after:  ${fixed.avgClv} pts (beat close ${fixed.beatCloseRate}%)`);
  console.log(`entries re-read: ${changes.length}; largest moves:`);
  for (const c of [...changes].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8)) {
    console.log(`  ${c.label}: entry ${c.delta >= 0 ? "+" : ""}${(c.delta * 100).toFixed(1)} pts`);
  }
  if (apply) {
    for (const c of changes) await prisma.pick.update({ where: { id: c.id }, data: { entryProb: c.entryProb } });
    console.log(`applied ${changes.length} updates`);
  } else {
    console.log("dry run — pass --apply to write");
  }
  await prisma.$disconnect();
}

main();
