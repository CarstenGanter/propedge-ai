/**
 * CLV for one slate, next to every pick through that slate:
 *
 *   npm run research:clv [-- YYYY-MM-DD]     (default: the latest slate with a closing line)
 *
 * Read-only, no Odds API credits. Same function as the analytics page's CLV
 * card, so the two never disagree. Voided picks are left out of both columns.
 */
import { prisma } from "@/lib/db/client";
import { clvDayAndToDate, type CLVSummary } from "@/lib/analysis/modelQuality";
import { emitSummary } from "@/lib/jobSummary";

async function main() {
  const picks = await prisma.pick.findMany({
    where: { isDemo: false, entryProb: { not: null }, closingProb: { not: null } },
    select: { date: true, entryProb: true, closingProb: true, status: true, placedReal: true },
  });
  const arg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const day = arg ?? picks.map((p) => p.date).sort().at(-1);
  if (!day) {
    console.log("No picks with a closing line yet.");
    return;
  }
  const items = picks.map((p) => ({ date: p.date, entryProb: p.entryProb!, closingProb: p.closingProb!, status: p.status }));
  const all = clvDayAndToDate(items, day);
  const taken = clvDayAndToDate(items.filter((_, i) => picks[i].placedReal), day);

  const fmt = (s: CLVSummary) =>
    s.count === 0
      ? "no picks".padEnd(40)
      : `${String(s.count).padStart(3)} picks  avg ${(s.avgClv >= 0 ? "+" : "") + s.avgClv.toFixed(2)} pts  beat close ${s.beatCloseRate.toFixed(0)}% (${s.positive}↑/${s.negative}↓)`.padEnd(40);
  console.log(`=== CLV — slate ${day} vs. every slate through it (voided picks left out) ===`);
  console.log(`${"".padEnd(14)}${"this slate".padEnd(44)}to date`);
  console.log(`${"All picks".padEnd(14)}${fmt(all.day)}    ${fmt(all.toDate)}`);
  console.log(`${"Picks taken".padEnd(14)}${fmt(taken.day)}    ${fmt(taken.toDate)}`);
  if (all.toDate.voidExcluded > 0) console.log(`  left out as void: ${all.day.voidExcluded} this slate, ${all.toDate.voidExcluded} to date`);
  emitSummary("clv", { day, all, taken });
  await prisma.$disconnect();
}

main();
