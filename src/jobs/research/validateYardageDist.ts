/**
 * Walk-forward test of distribution shape for yardage props. Every player-game
 * is predicted from that player's previous six games only; settings are tuned
 * on 2022-23 and scored, untouched, on 2024-25. Compares today's symmetric
 * Student-t against normal, gamma and log-normal (the last two on Y + c).
 *
 *   npx tsx src/jobs/research/validateYardageDist.ts <dir with ps_2021..2025.csv>
 */
import { readFileSync } from "node:fs";
import { gammaCdf, lognormalCdf, normalCdf, studentTCdf } from "@/lib/analysis/distributions";
import { cvPrior } from "@/lib/analysis/probabilityModel";
import { tokenizeCsv } from "@/lib/utils/csv";
import { binaryLogLoss, crps, intervalLogScore, medianOfCdf, type Cdf } from "@/lib/analysis/forecastScores";

const dir = process.argv[2];
type Row = Record<string, string>;
function parseCsv(path: string): Row[] {
  const [head, ...body] = tokenizeCsv(readFileSync(path, "utf8"));
  return body.map((cells) => {
    const r: Row = {};
    head.forEach((h, i) => (r[h] = cells[i] ?? ""));
    return r;
  });
}
const num = (v: string | undefined) => (v == null || v === "" || v === "NA" ? 0 : Number(v));

const PROPS = [
  { prop: "Receiving Yards", pos: ["WR", "TE"], value: (r: Row) => num(r.receiving_yards), min: 25 },
  { prop: "Rushing Yards", pos: ["RB"], value: (r: Row) => num(r.rushing_yards), min: 30 },
  { prop: "Passing Yards", pos: ["QB"], value: (r: Row) => num(r.passing_yards), min: 150 },
  { prop: "Rush+Rec Yards", pos: ["RB"], value: (r: Row) => num(r.rushing_yards) + num(r.receiving_yards), min: 40 },
];

interface Obs { season: number; mean: number; sd: number; y: number }

const rows: Row[] = [];
for (const y of [2021, 2022, 2023, 2024, 2025]) rows.push(...parseCsv(`${dir}/ps_${y}.csv`).filter((r) => r.season_type === "REG"));

type Family = "t" | "normal" | "gamma" | "lognormal";
function cdfFor(f: Family, mean: number, sd: number, c: number): Cdf {
  if (f === "t") return (x) => studentTCdf((x - mean) / sd, 5);
  if (f === "normal") return (x) => normalCdf((x - mean) / sd);
  const m = Math.max(mean + c, 1e-3);
  if (f === "gamma") {
    const k = (m * m) / (sd * sd);
    const th = (sd * sd) / m;
    return (x) => gammaCdf(x + c, k, th);
  }
  const s2 = Math.log(1 + (sd * sd) / (m * m));
  const mu = Math.log(m) - s2 / 2;
  return (x) => lognormalCdf(x + c, mu, Math.sqrt(s2));
}

for (const P of PROPS) {
  const byPlayer = new Map<string, Row[]>();
  for (const r of rows) if (P.pos.includes(r.position)) (byPlayer.get(r.player_id) ?? byPlayer.set(r.player_id, []).get(r.player_id)!).push(r);
  const obs: Obs[] = [];
  const cv = cvPrior(P.prop);
  for (const games of byPlayer.values()) {
    games.sort((a, b) => num(a.season) - num(b.season) || num(a.week) - num(b.week));
    const hist: number[] = [];
    for (const g of games) {
      const v = P.value(g);
      const season = num(g.season);
      if (hist.length >= 6 && season >= 2022) {
        const last = hist.slice(-6);
        const mean = last.reduce((a, b) => a + b, 0) / 6;
        if (mean >= P.min) {
          const sampleSd = Math.sqrt(last.reduce((a, b) => a + (b - mean) ** 2, 0) / 5);
          const w = 5 / (5 + 4); // production's weight on the sample sd with 6 games
          const prior = cv * mean;
          obs.push({ season, mean, sd: Math.sqrt(w * sampleSd ** 2 + (1 - w) * prior ** 2), y: v });
        }
      }
      hist.push(v);
    }
  }
  const fit = obs.filter((o) => o.season <= 2023);
  const test = obs.filter((o) => o.season >= 2024);

  const configs: { f: Family; c: number; scale: number }[] = [];
  const SCALES = process.env.FIXED_SCALE ? [Number(process.env.FIXED_SCALE)] : [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
  for (const scale of SCALES) {
    configs.push({ f: "t", c: 0, scale }, { f: "normal", c: 0, scale });
    for (const c of [0, 5, 10, 20, 30, 40]) configs.push({ f: "gamma", c, scale }, { f: "lognormal", c, scale });
  }
  const best = new Map<Family, { c: number; scale: number; score: number }>();
  for (const cfg of configs) {
    const score = fit.reduce((a, o) => a + intervalLogScore(cdfFor(cfg.f, o.mean, o.sd * cfg.scale, cfg.c), o.y), 0) / fit.length;
    const cur = best.get(cfg.f);
    if (!cur || score < cur.score) best.set(cfg.f, { c: cfg.c, scale: cfg.scale, score });
  }

  console.log(`\n${P.prop}  (fit n=${fit.length}, holdout n=${test.length})`);
  console.log(`  family      c  scale  CRPS    intervalLog  median-placement  binaryLogLoss`);
  const sub = test.filter((_, i) => i % Math.max(1, Math.floor(test.length / 3000)) === 0);
  for (const [f, b] of best) {
    let crpsSum = 0;
    for (const o of sub) {
      const sd = o.sd * b.scale;
      crpsSum += crps(cdfFor(f, o.mean, sd, b.c), o.y, Math.min(-20, o.mean - 6 * sd), o.mean + 8 * sd, 150);
    }
    let ils = 0, above = 0, bll = 0, bn = 0;
    for (const o of test) {
      const sd = o.sd * b.scale;
      const F = cdfFor(f, o.mean, sd, b.c);
      ils += intervalLogScore(F, o.y);
      const med = medianOfCdf(F, o.mean - 8 * sd, o.mean + 8 * sd);
      if (o.y > med) above++;
      for (const off of [0, -3, 3, -7, 7]) {
        const line = Math.round(o.mean) + 0.5 + off;
        bll += binaryLogLoss(1 - F(line), o.y > line);
        bn++;
      }
    }
    console.log(
      `  ${f.padEnd(10)}${String(b.c).padStart(3)}  ${b.scale.toFixed(1)}   ${(crpsSum / sub.length).toFixed(3)}  ${(ils / test.length).toFixed(4)}       ${((100 * above) / test.length).toFixed(1)}%             ${(bll / bn).toFixed(5)}`,
    );
  }
}
