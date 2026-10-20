/**
 * Who absorbs an absent player's volume (pure, tested) — roadmap task 4.
 *
 * When a regular is ruled out, his usual share of the team's targets (or
 * carries) is vacated. The pro-rata answer hands it to every active teammate in
 * proportion to their own share. The learned answer sends a fitted fraction to
 * each position group — M[from][to], a WR's targets going mostly to WRs, some
 * to the TE, little to RBs — and splits it inside the group by prior share plus
 * a smoothing term δ, so a backup promoted into the role can absorb some too.
 *
 * M and δ are fitted on nflverse 2022–24 by src/jobs/research/fitRedistribution.ts
 * and validated on 2025; the fitted tables are REDISTRIBUTION below.
 */

export const RECEIVING_POSITIONS = ["WR", "TE", "RB"] as const;
export const RUSHING_POSITIONS = ["RB", "QB", "WR"] as const;

/** One active teammate in a team-game where someone with a prior share is out. */
export interface ShareObs {
  teamGame: string;
  pos: string;
  /** His mean share over his previous games (the production window). */
  prior: number;
  /** His share of the team's volume in this game. */
  observed: number;
  /** The team's volume in this game (targets or carries). */
  teamVolume: number;
  /** Prior share vacated by out players, by their position. */
  vacated: Record<string, number>;
  /** Σ prior share of active players in his position group, and how many there are. */
  groupPriorSum: number;
  groupCount: number;
  /** Σ prior share of all active players. */
  activePriorSum: number;
}

export type RedistributionMatrix = Record<string, Record<string, number>>;

export interface Redistribution {
  matrix: RedistributionMatrix;
  delta: number;
}

/** No redistribution: everyone keeps his own share. */
export function noShift(o: ShareObs): number {
  return o.prior;
}

/** The vacated share to every active player in proportion to his own share. */
export function proRata(o: ShareObs): number {
  const vacated = Object.values(o.vacated).reduce((a, b) => a + b, 0);
  return o.activePriorSum > 0 ? o.prior + vacated * (o.prior / o.activePriorSum) : o.prior;
}

/** δ = Infinity splits a vacancy evenly inside the group, whatever each player's prior share. */
function withinGroupWeight(o: ShareObs, delta: number): number {
  if (!Number.isFinite(delta)) return o.groupCount > 0 ? 1 / o.groupCount : 0;
  const denom = o.groupPriorSum + delta * o.groupCount;
  return denom > 0 ? (o.prior + delta) / denom : 0;
}

/** The learned split: M[from][to] of each vacated share to his group, by prior share + δ inside it. */
export function learned(o: ShareObs, r: Redistribution): number {
  const w = withinGroupWeight(o, r.delta);
  let add = 0;
  for (const [from, v] of Object.entries(o.vacated)) add += v * (r.matrix[from]?.[o.pos] ?? 0) * w;
  return o.prior + add;
}

/** Ordinary least squares without an intercept; null when the system is singular. */
function ols(rows: number[][], y: number[]): number[] | null {
  const k = rows[0]?.length ?? 0;
  const xtx = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty = new Array(k).fill(0);
  rows.forEach((r, i) => {
    for (let a = 0; a < k; a++) {
      xty[a] += r[a] * y[i];
      for (let b = 0; b < k; b++) xtx[a][b] += r[a] * r[b];
    }
  });
  const m = xtx.map((row, i) => [...row, xty[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= k; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row, i) => row[k] / row[i]);
}

/**
 * Least squares with every coefficient ≥ 0 (active set: refit without the most
 * negative coefficient until none is left). A vacancy cannot take volume away
 * from a group; a negative fit is game script leaking into a small sample.
 */
function nonNegativeOls(rows: number[][], y: number[]): number[] | null {
  const k = rows[0]?.length ?? 0;
  const active = new Set(Array.from({ length: k }, (_, i) => i));
  for (;;) {
    const idx = [...active];
    const coef = new Array(k).fill(0);
    if (idx.length === 0) return coef;
    const sub = ols(rows.map((r) => idx.map((i) => r[i])), y);
    if (!sub) return null;
    idx.forEach((i, j) => (coef[i] = sub[j]));
    let worst = -1;
    for (const i of idx) if (coef[i] < 0 && (worst < 0 || coef[i] < coef[worst])) worst = i;
    if (worst < 0) return coef;
    active.delete(worst);
  }
}

/**
 * Fit M (one non-negative least-squares regression per destination group: the
 * share gained on the vacated shares by source position, each times the
 * within-group weight) and choose δ from `deltaGrid` by squared share error. A
 * source position with no vacancies in the data gets 0, not a guess.
 */
export function fitRedistribution(
  obs: ShareObs[],
  positions: readonly string[],
  deltaGrid: number[],
): Redistribution & { sse: number; n: number } {
  let best: (Redistribution & { sse: number; n: number }) | null = null;
  for (const delta of deltaGrid) {
    const matrix: RedistributionMatrix = Object.fromEntries(positions.map((p) => [p, {}]));
    for (const to of positions) {
      const mine = obs.filter((o) => o.pos === to);
      const sources = positions.filter((from) => mine.some((o) => (o.vacated[from] ?? 0) > 0));
      if (sources.length === 0) continue;
      const rows = mine.map((o) => sources.map((from) => (o.vacated[from] ?? 0) * withinGroupWeight(o, delta)));
      const coef = nonNegativeOls(rows, mine.map((o) => o.observed - o.prior));
      if (!coef) continue;
      sources.forEach((from, i) => (matrix[from][to] = coef[i]));
    }
    const r = { matrix, delta };
    const sse = obs.reduce((s, o) => s + (learned(o, r) - o.observed) ** 2, 0);
    if (!best || sse < best.sse) best = { ...r, sse, n: obs.length };
  }
  return best ?? { matrix: {}, delta: 0, sse: NaN, n: 0 };
}

/**
 * Production use: the expected shares of a team's active players once the out
 * players' prior shares are redistributed.
 */
export function redistribute(
  players: { id: string; pos: string; prior: number; active: boolean }[],
  r: Redistribution,
): Map<string, number> {
  const active = players.filter((p) => p.active);
  const vacated: Record<string, number> = {};
  for (const p of players) if (!p.active && p.prior > 0) vacated[p.pos] = (vacated[p.pos] ?? 0) + p.prior;
  const out = new Map<string, number>();
  for (const p of active) {
    const group = active.filter((q) => q.pos === p.pos);
    out.set(
      p.id,
      learned(
        {
          teamGame: "",
          pos: p.pos,
          prior: p.prior,
          observed: 0,
          teamVolume: 0,
          vacated,
          groupPriorSum: group.reduce((s, q) => s + q.prior, 0),
          groupCount: group.length,
          activePriorSum: active.reduce((s, q) => s + q.prior, 0),
        },
        r,
      ),
    );
  }
  return out;
}

/**
 * Fitted by src/jobs/research/fitRedistribution.ts on nflverse 2022–24, regular
 * season: non-negative least squares per destination group, δ by squared share
 * error; "out" = listed INA/RES and played in the team's previous game; prior
 * share = mean over the team's previous four games he played (nfl/usage.ts's
 * window). Scored untouched on 2025, teammates' next-game volume at the team's
 * actual total, MAE per teammate (95% game-bootstrap):
 *
 *   targets  7,469 teammate-games / 692 team-games; δ = ∞ (even split in group).
 *            2025 (2,732 / 243): vs pro-rata −0.058 [−0.080, −0.038];
 *            vs no redistribution +0.001 [−0.016, +0.018] — no better than
 *            leaving shares alone, so targets are not redistributed in production.
 *   carries  4,083 / 444; δ = 0.5.
 *            2025 (1,205 / 127): vs pro-rata −0.155 [−0.230, −0.081];
 *            vs no redistribution −0.098 [−0.153, −0.049]; with a vacancy of
 *            10%+ of team carries −0.176 [−0.274, −0.088].
 */
export const REDISTRIBUTION: { targets: Redistribution; carries: Redistribution } = {
  targets: {
    matrix: {
      WR: { WR: 0.71, TE: 0.116, RB: 0.075 },
      TE: { WR: 0.235, TE: 0.536, RB: 0.047 },
      RB: { WR: 0.063, TE: 0.129, RB: 0.673 },
    },
    delta: Infinity,
  },
  carries: {
    matrix: {
      RB: { RB: 0.821, QB: 0.047, WR: 0.016 },
      QB: { RB: 0.111, QB: 0.448, WR: 0 },
      WR: { RB: 0, QB: 0.533, WR: 0.014 },
    },
    delta: 0.5,
  },
};

/** Whether a fitted redistribution beat "leave shares alone" on held-out 2025. */
export const REDISTRIBUTION_VALIDATED = { targets: false, carries: true } as const;
