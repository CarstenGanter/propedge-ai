/**
 * The σ task, step 1: fit the consensus spread to the books' alternate ladders.
 *
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/research/fitConsensusSigma.ts
 *
 * For every player with an alternate ladder in the odds store, the main-line
 * quotes come from that prop's stored snapshot (or the store's slate quotes),
 * each book's one-sided alternates are de-vigged with its own main-line power
 * exponent, and σ = a + b × line is grid-searched per prop type to minimise the
 * squared error between the consensus's P(over) and the ladder's at every rung.
 * Only prices are used — no outcomes — so the weeks whose outcomes validate the
 * fit stay untouched.
 */
import { prisma } from "@/lib/db/client";
import { parseSnapshot } from "@/lib/marketSnapshot";
import { buildConsensus, consensusProbOver, type ConsensusSpread, type RawQuote } from "@/lib/analysis/marketConsensus";
import { affineSpread, CURRENT_SPREAD, devigLadder, fitAffineSigma, type Ladder } from "@/lib/analysis/consensusSpread";
import { teamsMatch } from "@/lib/utils/teamName";

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
  const alt = await prisma.oddsQuote.findMany({ where: { fetchKind: "alt" } });
  const groups = new Map<string, typeof alt>();
  for (const q of alt) {
    const k = `${q.eventId}|${q.playerName}|${q.propType}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(q);
  }

  const ladders: Ladder[] = [];
  const ladderDay: string[] = [];
  let noMain = 0;
  for (const qs of groups.values()) {
    const { playerName, propType, homeTeam, awayTeam, commenceTime } = qs[0];
    // Main lines: the store's slate quotes when held, else the prop's snapshot from that slate.
    const slate = await prisma.oddsQuote.findMany({ where: { fetchKind: "slate", eventId: qs[0].eventId, playerName, propType } });
    let main: RawQuote[] = slate.map((q) => ({ book: q.book, line: q.line, over: q.over, under: q.under }));
    if (main.length === 0) {
      const day = 86_400_000;
      const props = await prisma.playerProp.findMany({
        where: { playerName, propType, isDemo: false, gameStartTime: { gte: new Date(commenceTime.getTime() - day), lte: new Date(commenceTime.getTime() + day) } },
      });
      const prop = props.find((p) => teamsMatch(p.team, homeTeam) && teamsMatch(p.opponent, awayTeam));
      main = parseSnapshot(prop?.marketDataJson)?.quotes?.map((q) => ({ book: q.book, line: q.line, over: q.over, under: q.under })) ?? [];
    }
    if (main.length === 0) { noMain++; continue; }
    const rungs = devigLadder(main, qs.map((q) => ({ book: q.book, line: q.line, over: q.over })));
    if (rungs.length) {
      ladders.push({ propType, main, rungs });
      ladderDay.push(qs[0].fetchedAt.toISOString().slice(0, 10));
    }
  }

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
    const cur = rmsePts(ladders, CURRENT_SPREAD, f);
    const fit = rmsePts(ladders, fitted, f);
    console.log(`  ${label.padEnd(26)} n=${String(cur.n).padStart(5)}   current ${cur.rmse.toFixed(2).padStart(6)}   fitted ${fit.rmse.toFixed(2).padStart(6)}`);
  }
  console.log(`\nFITTED_SPREAD_PARAMS = ${JSON.stringify(params)}`);

  // Held-out prices: fit on every ladder slate but the newest, score on the newest.
  const days = [...new Set(ladderDay)].sort();
  if (days.length < 2) {
    console.log(`\nHeld-out price test: needs a second ladder slate (have ${days.join(", ") || "none"}); the next slate fetch buys one.`);
  } else {
    const last = days[days.length - 1];
    const train = ladders.filter((_, i) => ladderDay[i] !== last);
    const test = ladders.filter((_, i) => ladderDay[i] === last);
    const trainParams: Record<string, { a: number; b: number }> = {};
    for (const t of types) trainParams[t] = (({ a, b }) => ({ a, b }))(fitAffineSigma(t, train));
    const cur = rmsePts(test, CURRENT_SPREAD);
    const held = rmsePts(test, affineSpread(trainParams));
    console.log(`\nHeld-out price test (fit on slates before ${last}, scored on ${last}): ${JSON.stringify(trainParams)}`);
    console.log(`  RMSE on ${held.n} held-out rungs: current ${cur.rmse.toFixed(2)} pts, fitted ${held.rmse.toFixed(2)} pts`);
  }
  await prisma.$disconnect();
}

main();
