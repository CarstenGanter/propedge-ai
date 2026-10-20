/**
 * Scoring the model against the market, not a coin flip (pure, tested).
 *
 * The question every model change has to answer is whether its probabilities
 * carry information the de-vigged consensus does not. Log-loss skill answers
 * it on identical props: 1 − LL_model / LL_market. Positive means the model
 * adds information; zero means it is the market; negative means it subtracts.
 *
 * Props in one game share a game script, so they are not independent trials.
 * Intervals resample whole games (a cluster bootstrap); the effective sample is
 * games, not props.
 */

export interface SkillItem {
  /** Model P(over) at `line`. */
  pModel: number;
  /** De-vigged consensus P(over) at the same line. */
  pMarket: number;
  /** Did the stat finish over the line? Pushes are excluded before scoring. */
  over: boolean;
  /** Game identifier: the bootstrap resamples these. */
  cluster: string;
  propType: string;
  edgeSource?: string;
  /** Slate date, for a by-week view. */
  date?: string;
}

const EPS = 1e-6;

function ll(p: number, hit: boolean): number {
  const q = Math.min(1 - EPS, Math.max(EPS, p));
  return -Math.log(hit ? q : 1 - q);
}

export interface SkillScore {
  n: number;
  games: number;
  llModel: number;
  llMarket: number;
  /** 1 − LL_model / LL_market. */
  skill: number;
}

export function skillScore(items: SkillItem[]): SkillScore | null {
  if (items.length === 0) return null;
  let m = 0;
  let k = 0;
  for (const it of items) {
    m += ll(it.pModel, it.over);
    k += ll(it.pMarket, it.over);
  }
  const llModel = m / items.length;
  const llMarket = k / items.length;
  return {
    n: items.length,
    games: new Set(items.map((i) => i.cluster)).size,
    llModel,
    llMarket,
    skill: llMarket > 0 ? 1 - llModel / llMarket : 0,
  };
}

/** Small seeded PRNG so a bootstrap gives the same interval every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) (m.get(key(x)) ?? m.set(key(x), []).get(key(x))!).push(x);
  return m;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export interface Interval {
  lo: number;
  hi: number;
}

/**
 * Percentile interval for `stat`, resampling whole games with replacement.
 * Null with fewer than two games: one game cannot be resampled into a spread.
 */
export function clusterBootstrap<T extends { cluster: string }>(
  items: T[],
  stat: (sample: T[]) => number | null,
  opts: { reps?: number; seed?: number; level?: number } = {},
): Interval | null {
  return clusterBootstrapMany(items, (s) => {
    const v = stat(s);
    return v == null ? null : [v];
  }, opts)?.[0] ?? null;
}

/** The same for a statistic with several components (e.g. regression coefficients), one interval each. */
export function clusterBootstrapMany<T extends { cluster: string }>(
  items: T[],
  stat: (sample: T[]) => number[] | null,
  opts: { reps?: number; seed?: number; level?: number } = {},
): Interval[] | null {
  const clusters = [...groupBy(items, (i) => i.cluster).values()];
  if (clusters.length < 2) return null;
  const reps = opts.reps ?? 2000;
  const rand = mulberry32(opts.seed ?? 20261019);
  const level = opts.level ?? 0.95;
  const draws: number[][] = [];
  for (let r = 0; r < reps; r++) {
    const sample: T[] = [];
    for (let c = 0; c < clusters.length; c++) sample.push(...clusters[Math.floor(rand() * clusters.length)]);
    const v = stat(sample);
    if (v && v.every((x) => Number.isFinite(x))) draws.push(v);
  }
  if (draws.length === 0) return null;
  return draws[0].map((_, k) => {
    const col = draws.map((d) => d[k]).sort((a, b) => a - b);
    return { lo: quantile(col, (1 - level) / 2), hi: quantile(col, 1 - (1 - level) / 2) };
  });
}

/** The side the model rates above the market, or null when they agree. */
export function leanSide(it: Pick<SkillItem, "pModel" | "pMarket">): "OVER" | "UNDER" | null {
  if (Math.abs(it.pModel - it.pMarket) < 1e-9) return null;
  return it.pModel > it.pMarket ? "OVER" : "UNDER";
}

export interface EdgeBucket {
  /** Claimed edge range in probability points, e.g. "2–4". */
  label: string;
  n: number;
  meanClaimedPts: number;
  /** Hits on the model's side minus the hits the market expected there, per prop, in points. */
  excessPts: number;
  excessInterval: Interval | null;
}

/** Hits on the leaned side minus the market's expected hits there, per prop, in points. */
export function excessPts(items: SkillItem[]): number | null {
  const leaned = items.filter((i) => leanSide(i) != null);
  if (leaned.length === 0) return null;
  let sum = 0;
  for (const it of leaned) {
    const side = leanSide(it)!;
    const hit = side === "OVER" ? it.over : !it.over;
    const expected = side === "OVER" ? it.pMarket : 1 - it.pMarket;
    sum += (hit ? 1 : 0) - expected;
  }
  return (sum / leaned.length) * 100;
}

/**
 * Group props by how far the model claims to beat the market. If the claimed
 * edge were real, the excess would rise across buckets; if it doesn't, the
 * edge estimate is noise. Bucket edges are display bins, in points.
 */
export function bucketedEdge(
  items: SkillItem[],
  edgesPts: number[] = [0, 1, 2, 4, 8],
  opts: { reps?: number; seed?: number } = {},
): EdgeBucket[] {
  const out: EdgeBucket[] = [];
  for (let b = 0; b < edgesPts.length; b++) {
    const lo = edgesPts[b];
    const hi = edgesPts[b + 1] ?? Infinity;
    const inBucket = items.filter((i) => {
      const pts = Math.abs(i.pModel - i.pMarket) * 100;
      return leanSide(i) != null && pts >= lo && pts < hi;
    });
    if (inBucket.length === 0) continue;
    out.push({
      label: hi === Infinity ? `${lo}+` : `${lo}–${hi}`,
      n: inBucket.length,
      meanClaimedPts: (inBucket.reduce((s, i) => s + Math.abs(i.pModel - i.pMarket), 0) / inBucket.length) * 100,
      excessPts: excessPts(inBucket)!,
      excessInterval: clusterBootstrap(inBucket, excessPts, opts),
    });
  }
  return out;
}

export interface SkillBreakdown {
  key: string;
  score: SkillScore;
  interval: Interval | null;
}

export function skillBy(
  items: SkillItem[],
  key: (i: SkillItem) => string | null,
  opts: { reps?: number; seed?: number } = {},
): SkillBreakdown[] {
  const groups = new Map<string, SkillItem[]>();
  for (const it of items) {
    const k = key(it);
    if (k == null) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  return [...groups.entries()]
    .map(([k, xs]) => ({ key: k, score: skillScore(xs)!, interval: clusterBootstrap(xs, (s) => skillScore(s)?.skill ?? null, opts) }))
    .sort((a, b) => b.score.n - a.score.n);
}

export interface SkillReport {
  overall: SkillScore | null;
  interval: Interval | null;
  byPropType: SkillBreakdown[];
  /** By the side the model leans relative to the market. */
  byLean: SkillBreakdown[];
  buckets: EdgeBucket[];
  byEdgeSource: SkillBreakdown[];
}

export function skillReport(items: SkillItem[], opts: { reps?: number; seed?: number } = {}): SkillReport {
  return {
    overall: skillScore(items),
    interval: clusterBootstrap(items, (s) => skillScore(s)?.skill ?? null, opts),
    byPropType: skillBy(items, (i) => i.propType, opts),
    byLean: skillBy(items, (i) => leanSide(i) ?? "agrees", opts),
    buckets: bucketedEdge(items, undefined, opts),
    byEdgeSource: skillBy(items, (i) => i.edgeSource ?? "unknown", opts),
  };
}

/** Return on stake for settled picks with the payout actually entered: win pays (payout − 1), loss −1. */
export function roiWithPayouts(bets: { payout: number; won: boolean }[]): { n: number; roi: number } | null {
  const valid = bets.filter((b) => Number.isFinite(b.payout) && b.payout > 1);
  if (valid.length === 0) return null;
  const pnl = valid.reduce((s, b) => s + (b.won ? b.payout - 1 : -1), 0);
  return { n: valid.length, roi: pnl / valid.length };
}

// ---- edge source: a deterministic rule ----

export type EdgeSource = "venue" | "news" | "model" | "unknown";

/**
 * Why a forecast might differ from the market, assigned by rule, never by hand:
 *  - venue: the venue line is priced and the books give the played side at
 *    least SOFT_LINE_THRESHOLD more or less there than at their own line (the
 *    same test as the line table's soft/tough flag);
 *  - news: the player's injury status, or the teammate-absence boost, changed
 *    since this prop's previous logged forecast;
 *  - model: neither.
 * Venue wins over news: it is the edge that has held up.
 */
export function edgeSourceFor(input: {
  venueFlag: "soft" | "tough" | "none" | null;
  previous: { playerStatus: string | null; teammateOut: boolean | null } | null;
  playerStatus: string | null;
  teammateOut: boolean | null;
}): EdgeSource {
  if (input.venueFlag === "soft" || input.venueFlag === "tough") return "venue";
  const prev = input.previous;
  if (prev && ((prev.playerStatus ?? null) !== (input.playerStatus ?? null) || (prev.teammateOut ?? false) !== (input.teammateOut ?? false))) {
    return "news";
  }
  return "model";
}

// ---- does the player layer add anything? ----

export function logit(p: number): number {
  const q = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return Math.log(q / (1 - q));
}

/**
 * Logistic regression by Newton–Raphson (IRLS). `x` rows exclude the
 * intercept, which is added as the first coefficient. Null when the fit does
 * not converge (e.g. perfect separation in a small resample).
 */
export function fitLogistic(x: number[][], y: boolean[], maxIter = 50): number[] | null {
  const k = (x[0]?.length ?? 0) + 1;
  let b = new Array(k).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const g = new Array(k).fill(0);
    const h = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < x.length; i++) {
      const row = [1, ...x[i]];
      const eta = row.reduce((s, v, j) => s + v * b[j], 0);
      const p = 1 / (1 + Math.exp(-eta));
      const w = p * (1 - p);
      for (let j = 0; j < k; j++) {
        g[j] += row[j] * ((y[i] ? 1 : 0) - p);
        for (let l = 0; l < k; l++) h[j][l] += w * row[j] * row[l];
      }
    }
    const step = solve(h, g);
    if (!step) return null;
    b = b.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) return b;
  }
  return b.every(Number.isFinite) ? b : null;
}

/** Gaussian elimination with partial pivoting; null for a singular system. */
function solve(a: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const m = a.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

export interface StackingResult {
  n: number;
  games: number;
  /** [intercept, market coefficient, model coefficient] on the logit scale. */
  coef: number[];
  intervals: Interval[] | null;
}

/**
 * outcome ~ logit(p_market) + logit(p_model). A calibrated market alone gives a
 * market coefficient near 1; the model adds information only if its
 * coefficient's interval excludes 0.
 */
export function stackingFit(items: SkillItem[], opts: { reps?: number; seed?: number } = {}): StackingResult | null {
  const fit = (xs: SkillItem[]) => fitLogistic(xs.map((i) => [logit(i.pMarket), logit(i.pModel)]), xs.map((i) => i.over));
  const coef = items.length >= 3 ? fit(items) : null;
  if (!coef) return null;
  return {
    n: items.length,
    games: new Set(items.map((i) => i.cluster)).size,
    coef,
    intervals: clusterBootstrapMany(items, fit, opts),
  };
}
