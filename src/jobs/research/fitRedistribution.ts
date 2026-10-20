/**
 * Roadmap task 4: fit how an out player's volume is redistributed, and test it.
 *
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/research/fitRedistribution.ts
 *
 * nflverse 2022–25, regular season. A player is newly "out" in a week when
 * that week's roster lists him inactive (INA) or on reserve (RES) and he played
 * in the team's previous game — the first game missed, where the news is new
 * and teammates' recent shares don't already reflect it. His vacated share is
 * his mean share over the team's previous four games (the production usage
 * window, nfl/usage.ts) in which he played.
 * Every active teammate in such a team-game is an observation: his share that
 * game against his own prior share. M and δ are fitted on 2022–24 and scored,
 * untouched, on 2025 — teammates' next-game targets and carries, using the
 * team's actual volume so only the redistribution is tested — against the
 * pro-rata baseline and against no redistribution.
 */
import zlib from "node:zlib";
import { parseCsv } from "@/lib/utils/csv";
import {
  fitRedistribution,
  learned,
  noShift,
  proRata,
  RECEIVING_POSITIONS,
  RUSHING_POSITIONS,
  type Redistribution,
  type ShareObs,
} from "@/lib/nfl/vacatedVolume";
import { clusterBootstrap } from "@/lib/analysis/marketSkill";

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";
const WINDOW = 4; // the production usage window (nfl/usage.ts summarizeUsage)
const OUT_STATUSES = new Set(["INA", "RES"]);
// Infinity = split evenly inside the group, so the grid's edge is a real option, not a cut-off.
const DELTA_GRID = [0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, Infinity];

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return url.endsWith(".gz") ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

const posOf = (p: string) => (p === "FB" ? "RB" : p);

interface PlayerWeek {
  gsis: string;
  pos: string;
  targets: number;
  carries: number;
}

async function seasonObservations(season: number, volume: "targets" | "carries", positions: readonly string[]): Promise<ShareObs[]> {
  const [weekly, snaps, roster] = await Promise.all([
    fetchCsv(`${BASE}/stats_player/stats_player_week_${season}.csv.gz`),
    fetchCsv(`${BASE}/snap_counts/snap_counts_${season}.csv.gz`),
    fetchCsv(`${BASE}/weekly_rosters/roster_weekly_${season}.csv`),
  ]);
  const rosterRows = parseCsv(roster).rows;
  const pfrToGsis = new Map(rosterRows.filter((r) => r.pfr_id && r.gsis_id).map((r) => [r.pfr_id, r.gsis_id]));
  const posByGsis = new Map(rosterRows.filter((r) => r.gsis_id).map((r) => [r.gsis_id, posOf(r.position ?? "")]));

  // team-week → players who played (stat row or an offensive snap), with their volume
  const games = new Map<string, Map<string, PlayerWeek>>();
  const key = (team: string, week: number) => `${team}|${week}`;
  const touch = (team: string, week: number, gsis: string, pos: string) => {
    const g = games.get(key(team, week)) ?? games.set(key(team, week), new Map()).get(key(team, week))!;
    return g.get(gsis) ?? g.set(gsis, { gsis, pos, targets: 0, carries: 0 }).get(gsis)!;
  };
  for (const r of parseCsv(weekly).rows) {
    if (r.season_type !== "REG" || !r.player_id) continue;
    const p = touch(r.team, Number(r.week), r.player_id, posOf(r.position ?? ""));
    p.targets = Number(r.targets) || 0;
    p.carries = Number(r.carries) || 0;
  }
  for (const r of parseCsv(snaps).rows) {
    if (r.game_type !== "REG" || !(Number(r.offense_snaps) > 0)) continue;
    const gsis = pfrToGsis.get(r.pfr_player_id);
    if (gsis) touch(r.team, Number(r.week), gsis, posByGsis.get(gsis) ?? posOf(r.position ?? ""));
  }
  const outByGame = new Map<string, Set<string>>();
  for (const r of rosterRows) {
    if (r.game_type && r.game_type !== "REG") continue;
    if (!OUT_STATUSES.has(r.status) || !r.gsis_id) continue;
    const k = key(r.team, Number(r.week));
    (outByGame.get(k) ?? outByGame.set(k, new Set()).get(k)!).add(r.gsis_id);
  }

  // each team's games in order, with every player's share of that game
  const byTeam = new Map<string, number[]>();
  for (const k of games.keys()) {
    const [team, w] = k.split("|");
    (byTeam.get(team) ?? byTeam.set(team, []).get(team)!).push(Number(w));
  }
  const share = (team: string, week: number, gsis: string): number | null => {
    const g = games.get(key(team, week));
    const p = g?.get(gsis);
    if (!g || !p) return null;
    const total = [...g.values()].reduce((s, x) => s + x[volume], 0);
    return total > 0 ? p[volume] / total : null;
  };

  const out: ShareObs[] = [];
  for (const [team, weeks] of byTeam) {
    weeks.sort((a, b) => a - b);
    weeks.forEach((week, idx) => {
      if (idx === 0) return;
      const previous = weeks.slice(Math.max(0, idx - WINDOW), idx);
      const priorShare = (gsis: string) => {
        const xs = previous.map((w) => share(team, w, gsis)).filter((x): x is number => x != null);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      };
      const g = games.get(key(team, week))!;
      const teamVolume = [...g.values()].reduce((s, x) => s + x[volume], 0);
      if (teamVolume === 0) return;
      // newly out: listed INA/RES this week, and played in the team's previous game
      const vacated: Record<string, number> = {};
      const lastGame = games.get(key(team, weeks[idx - 1]));
      for (const gsis of outByGame.get(key(team, week)) ?? []) {
        if (g.has(gsis)) continue; // listed but played: not out
        if (!lastGame?.has(gsis)) continue; // already out last game: his absence is in everyone's recent shares
        const pos = posByGsis.get(gsis) ?? "";
        if (!positions.includes(pos)) continue;
        const s = priorShare(gsis);
        if (s > 0) vacated[pos] = (vacated[pos] ?? 0) + s;
      }
      if (Object.keys(vacated).length === 0) return;
      const active = [...g.values()].filter((p) => positions.includes(p.pos)).map((p) => ({ ...p, prior: priorShare(p.gsis) }));
      const activePriorSum = active.reduce((s, p) => s + p.prior, 0);
      for (const p of active) {
        const group = active.filter((q) => q.pos === p.pos);
        out.push({
          teamGame: `${season}|${team}|${week}`,
          pos: p.pos,
          prior: p.prior,
          observed: p[volume] / teamVolume,
          teamVolume,
          vacated,
          groupPriorSum: group.reduce((s, q) => s + q.prior, 0),
          groupCount: group.length,
          activePriorSum,
        });
      }
    });
  }
  return out;
}

function mae(obs: ShareObs[], predict: (o: ShareObs) => number) {
  return obs.reduce((s, o) => s + Math.abs(predict(o) * o.teamVolume - o.observed * o.teamVolume), 0) / obs.length;
}

function report(label: string, test: ShareObs[], fit: Redistribution) {
  const items = test.map((o) => ({ cluster: o.teamGame, o }));
  const diff = (xs: typeof items, a: (o: ShareObs) => number, b: (o: ShareObs) => number) =>
    xs.length ? xs.reduce((s, x) => s + Math.abs(a(x.o) * x.o.teamVolume - x.o.observed * x.o.teamVolume) - Math.abs(b(x.o) * x.o.teamVolume - x.o.observed * x.o.teamVolume), 0) / xs.length : null;
  const vsPro = clusterBootstrap(items, (xs) => diff(xs, (o) => learned(o, fit), proRata));
  const vsNone = clusterBootstrap(items, (xs) => diff(xs, (o) => learned(o, fit), noShift));
  console.log(`  ${label}: ${test.length} teammate-games in ${new Set(test.map((o) => o.teamGame)).size} team-games`);
  console.log(`    MAE per teammate — no redistribution ${mae(test, noShift).toFixed(3)}, pro-rata ${mae(test, proRata).toFixed(3)}, learned ${mae(test, (o) => learned(o, fit)).toFixed(3)}`);
  console.log(`    learned − pro-rata ${diff(items, (o) => learned(o, fit), proRata)!.toFixed(4)} ${vsPro ? `[${vsPro.lo.toFixed(4)}, ${vsPro.hi.toFixed(4)}]` : ""}; learned − none ${diff(items, (o) => learned(o, fit), noShift)!.toFixed(4)} ${vsNone ? `[${vsNone.lo.toFixed(4)}, ${vsNone.hi.toFixed(4)}]` : ""}`);
}

async function run(volume: "targets" | "carries", positions: readonly string[]) {
  const train: ShareObs[] = [];
  for (const s of [2022, 2023, 2024]) train.push(...(await seasonObservations(s, volume, positions)));
  const test = await seasonObservations(2025, volume, positions);
  const fit = fitRedistribution(train, positions, DELTA_GRID);
  console.log(`\n=== ${volume}: fitted on 2022–24 (${fit.n} teammate-games in ${new Set(train.map((o) => o.teamGame)).size} team-games), δ = ${fit.delta} ===`);
  for (const from of positions) {
    const row = positions.map((to) => `${to} ${(fit.matrix[from]?.[to] ?? 0).toFixed(3)}`).join("  ");
    console.log(`  M[${from} out → ]  ${row}`);
  }
  console.log(`  REDISTRIBUTION.${volume} = ${JSON.stringify({ matrix: fit.matrix, delta: fit.delta })}`);
  console.log("  held out, 2025 (lower MAE is better; intervals resample team-games):");
  report("all", test, fit);
  report("vacated share ≥ 10% of the team's volume", test.filter((o) => Object.values(o.vacated).reduce((a, b) => a + b, 0) >= 0.1), fit);
}

async function main() {
  await run("targets", RECEIVING_POSITIONS);
  await run("carries", RUSHING_POSITIONS);
}

main();
