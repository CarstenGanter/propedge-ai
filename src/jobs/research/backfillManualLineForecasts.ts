/**
 * One-off backfill (2026-10-26): forecast rows for Underdog lines typed in by
 * hand after the scoring run, before applyUnderdogLine logged them itself.
 *
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/research/backfillManualLineForecasts.ts [--apply]
 *
 * Re-scoring now would see the game, so the model's probability is the one the
 * re-score stored on the pick at entry (its confidenceScore, whole percent;
 * the unclipped probability was never stored, so modelRawProbOver stays null).
 * The market side is exact: the stored gameday snapshot at the typed line.
 * Player status comes from the prop's last live row before the entry. A prop
 * whose quotes are not of known pre-kickoff time is flagged, never written.
 * Dry run unless --apply.
 */
import { prisma } from "@/lib/db/client";
import { consensusOf, parseSnapshot } from "@/lib/marketSnapshot";
import { buildManualLinePrediction } from "@/lib/predictionLog";

/** The forecast log's live rows start here; earlier manual lines had no run to miss. */
const LOG_START = new Date("2026-10-20T05:00:00Z");

async function main() {
  const apply = process.argv.includes("--apply");
  const props = await prisma.playerProp.findMany({
    where: { isDemo: false, underdogLineSource: "manual", underdogLine: { not: null }, underdogLineAt: { gte: LOG_START } },
    include: { picks: true, predictions: { where: { source: "live" }, orderBy: { createdAt: "asc" } } },
    orderBy: { underdogLineAt: "asc" },
  });
  let written = 0;
  for (const p of props) {
    const label = `${p.date} ${p.playerName} ${p.propType} ${p.direction} ${p.underdogLine}`;
    if (p.predictions.some((r) => r.line === p.underdogLine)) continue;
    const enteredAt = p.underdogLineAt!;
    if (p.predictions.some((r) => r.createdAt > enteredAt)) {
      console.log(`FLAG ${label}: a scoring run came after the entry, so the pick's score is not the entry-time one`);
      continue;
    }
    const pick = p.picks.find((k) => !k.isDemo);
    if (!pick || pick.scoringProfile !== "distribution") {
      console.log(`FLAG ${label}: no distribution-model pick holding the entry-time probability`);
      continue;
    }
    const snapshot = parseSnapshot(p.marketDataJson);
    const previous = p.predictions.at(-1) ?? null;
    const row = buildManualLinePrediction({
      prop: p,
      modelProbability: pick.confidenceScore / 100,
      modelRawProbability: null,
      consensus: consensusOf(snapshot),
      snapshot,
      playerStatus: previous?.playerStatus ?? null,
      teammateOut: previous?.teammateOut ?? null,
      previous,
      modelVersion: pick.modelVersion,
      enteredAt,
      kickoff: p.gameStartTime,
      playerOut: false,
    });
    if (!row) {
      console.log(`FLAG ${label}: no pre-kickoff quote time (or no market) — not backfilled`);
      continue;
    }
    console.log(
      `${apply ? "WRITE" : "would write"} ${label}: model P(over) ${row.modelProbOver.toFixed(3)}, books P(over) ${row.marketProbOver.toFixed(4)}, ` +
        `quoted ${(row.quotedAt as Date).toISOString()}, stamped ${enteredAt.toISOString()}, kickoff ${p.gameStartTime?.toISOString()}, edge source ${row.edgeSource}`,
    );
    if (apply) await prisma.propPrediction.create({ data: row });
    written++;
  }
  console.log(`${written} row(s) ${apply ? "written" : "to write (dry run; --apply to write)"}`);
  await prisma.$disconnect();
}

main();
