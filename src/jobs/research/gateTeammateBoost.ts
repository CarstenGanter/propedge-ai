/**
 * Task 1's gate for removing the flat +6% teammate-absence boost from
 * receiving props (2026-10-20).
 *
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/research/gateTeammateBoost.ts
 *
 * The live boost fires when a same-position teammate (WR or TE for receiving
 * props — slate.ts positionsBoostingProp) is out or doubtful on ESPN's game
 * report. That report was never stored for old props, so it is reconstructed
 * from that week's nflverse roster: a WR/TE teammate listed inactive or on
 * reserve. ESPN's report does not list every injured-reserve player, so the
 * reconstruction is chosen by how often it fires: production flagged a
 * teammate out on about half of stored receiving picks (40 of 73). Three
 * definitions are run; the one whose rate matches is the gate. On the primary
 * sample — graded consensus-v2 receiving props — baseline-v0 is scored with
 * the boost and without it, each against the market.
 */
import { prisma } from "@/lib/db/client";
import { parseCsv } from "@/lib/utils/csv";
import { nflverseCode } from "@/lib/nfl/teamCodes";
import { positionsBoostingProp } from "@/lib/nfl/slate";
import { gradeProp, priorGames } from "@/lib/nfl/gradeProps";
import { estimateProbability, NO_TEAMMATE_BOOST } from "@/lib/analysis/probabilityModel";
import { consensusProbOver } from "@/lib/analysis/marketConsensus";
import { consensusOf, parseSnapshot } from "@/lib/marketSnapshot";
import { overProb } from "@/lib/predictionLog";
import { clusterBootstrap, skillScore, type SkillItem } from "@/lib/analysis/marketSkill";
import { BASE, fetchCsv, loadSeason } from "@/lib/nfl/nflverseSeasons";

/** How often production's flag fired on stored receiving picks (evidence text), 2026-09-20 → 10-19. */
const PRODUCTION_FIRE_RATE = 40 / 73;

type Definition = { name: string; out: (r: { status: string; gsisId: string; week: number; team: string }) => boolean };

function ll(p: number, hit: boolean) {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return -Math.log(hit ? q : 1 - q);
}

async function main() {
  const players = parseCsv(await fetchCsv(`${BASE}/players/players.csv`)).rows;
  const pfrToGsis = new Map(players.filter((p) => p.pfr_id && p.gsis_id).map((p) => [p.pfr_id, p.gsis_id]));
  const [current, prior] = await Promise.all([loadSeason(2026, pfrToGsis), loadSeason(2025, pfrToGsis)]);
  const roster = current.roster ?? [];

  const props = await prisma.playerProp.findMany({
    where: { sport: "NFL", isDemo: false, propType: { in: [...NO_TEAMMATE_BOOST] }, actualResult: { not: null }, date: { gte: "2026-10-01" } },
  });
  const posOf = new Map(roster.map((r) => [r.gsisId, r.position ?? ""]));
  const playedRecently = (gsis: string, team: string, week: number) =>
    current.rows.some((r) => r.gsisId === gsis && r.team === team && r.week < week && r.week >= week - 4) ||
    current.appearances.some((a) => a.gsisId === gsis && a.team === team && a.week < week && a.week >= week - 4);
  const definitions: Definition[] = [
    { name: "inactive or reserve", out: (r) => r.status === "INA" || r.status === "RES" },
    { name: "inactive only", out: (r) => r.status === "INA" },
    { name: "inactive or reserve, played in the last 4", out: (r) => (r.status === "INA" || r.status === "RES") && playedRecently(r.gsisId, r.team, r.week) },
  ];

  type Row = { cluster: string; over: boolean; marketOver: number; pWith: (d: Definition) => number | null; pWithout: number; fires: (d: Definition) => boolean };
  const rows: Row[] = [];
  for (const p of props) {
    const snap = parseSnapshot(p.marketDataJson);
    if (!snap?.quotes?.length) continue;
    const m = consensusOf(snap);
    const home = nflverseCode(p.team);
    const away = nflverseCode(p.opponent);
    if (!m || !home || !away) continue;
    const g = gradeProp({ playerName: p.playerName, espnId: p.espnAthleteId, propType: p.propType, home, away }, current);
    if (g.kind !== "graded" || g.value === m.referenceLine) continue;
    const myTeam = roster.find((r) => r.gsisId === g.gsisId && r.week === g.week)?.team;
    const boosting = positionsBoostingProp(p.propType);
    const line = m.referenceLine;
    const marketOver = consensusProbOver(m, line);
    const direction = marketOver >= 0.5 ? "OVER" : "UNDER";
    const games = priorGames(g.gsisId, p.propType, g.week, current, prior);
    const base = { line, direction, propType: p.propType, games, marketProbOver: marketOver, marketLine: line } as const;
    const without = estimateProbability({ ...base, adjustments: [] });
    const boosted = estimateProbability({ ...base, adjustments: [0.06] });
    if (!without || !boosted) continue;
    const fires = (d: Definition) =>
      !!myTeam &&
      roster.some((r) => r.week === g.week && r.team === myTeam && r.gsisId !== g.gsisId && boosting.includes(posOf.get(r.gsisId) ?? "") && d.out(r));
    rows.push({
      cluster: `${p.date}|${p.team}|${p.opponent}`,
      over: g.value > line,
      marketOver,
      pWithout: overProb(without.probability, direction),
      pWith: (d) => (fires(d) ? overProb(boosted.probability, direction) : overProb(without.probability, direction)),
      fires,
    });
  }
  const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
  const itemsOf = (pm: (r: Row) => number): SkillItem[] => rows.map((r) => ({ pModel: pm(r), pMarket: r.marketOver, over: r.over, cluster: r.cluster, propType: "receiving" }));
  const without = itemsOf((r) => r.pWithout);
  const sb = skillScore(without)!;
  const ib = clusterBootstrap(without, (x) => skillScore(x)?.skill ?? null);
  console.log(`Receiving props (Receiving Yards, Receptions), primary sample: ${sb.n} props, ${sb.games} games. Production fire rate ${pct(PRODUCTION_FIRE_RATE)}.`);
  console.log(`  without the boost (the change)   skill vs market ${pct(sb.skill)} [${pct(ib?.lo ?? NaN)}, ${pct(ib?.hi ?? NaN)}]`);
  let closest: { d: Definition; rate: number } | null = null;
  for (const d of definitions) {
    const rate = rows.filter((r) => r.fires(d)).length / rows.length;
    if (!closest || Math.abs(rate - PRODUCTION_FIRE_RATE) < Math.abs(closest.rate - PRODUCTION_FIRE_RATE)) closest = { d, rate };
    const withItems = itemsOf((r) => r.pWith(d)!);
    const sa = skillScore(withItems)!;
    const ia = clusterBootstrap(withItems, (x) => skillScore(x)?.skill ?? null);
    const affected = rows.filter((r) => r.fires(d)).map((r) => ({ cluster: r.cluster, d: ll(r.pWithout, r.over) - ll(r.pWith(d)!, r.over) }));
    const mean = (xs: typeof affected) => (xs.length ? xs.reduce((s, x) => s + x.d, 0) / xs.length : null);
    const id = clusterBootstrap(affected, mean);
    console.log(`\n  "${d.name}": fires on ${(rate * 100).toFixed(0)}% of props`);
    console.log(`    with the boost (before)        skill vs market ${pct(sa.skill)} [${pct(ia?.lo ?? NaN)}, ${pct(ia?.hi ?? NaN)}]`);
    console.log(`    on the ${affected.length} affected props, log-loss without − with: ${mean(affected)?.toFixed(5) ?? "n/a"}${id ? ` [${id.lo.toFixed(5)}, ${id.hi.toFixed(5)}]` : ""} (negative = removing it helps)`);
  }
  console.log(`\nGate uses "${closest!.d.name}" (fires on ${(closest!.rate * 100).toFixed(0)}%, production ${(PRODUCTION_FIRE_RATE * 100).toFixed(0)}%).`);
  await prisma.$disconnect();
}

main();
