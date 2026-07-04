/**
 * Model-quality metrics: how good are our probabilities, and are we beating the
 * closing line? These *measure* edge rather than assume it — the honest core of
 * a research tool. All pure & deterministic.
 */

/** One decided prediction: model probability of the outcome, and whether it occurred. */
export interface CalibrationItem {
  p: number; // model probability the pick wins/hits, 0..1
  hit: boolean;
}

/**
 * Brier score = mean squared error of probability forecasts (0 = perfect, 0.25 =
 * always guessing 50/50, 1 = confidently wrong). Lower is better.
 */
export function brierScore(items: CalibrationItem[]): number | null {
  if (items.length === 0) return null;
  const sum = items.reduce((s, it) => s + (clamp01(it.p) - (it.hit ? 1 : 0)) ** 2, 0);
  return round4(sum / items.length);
}

/** Logarithmic loss (a.k.a. cross-entropy). Punishes confident wrong calls harder. */
export function logLoss(items: CalibrationItem[]): number | null {
  if (items.length === 0) return null;
  const eps = 1e-6;
  const sum = items.reduce((s, it) => {
    const p = Math.min(1 - eps, Math.max(eps, it.p));
    return s + (it.hit ? -Math.log(p) : -Math.log(1 - p));
  }, 0);
  return round4(sum / items.length);
}

/**
 * "Skill" vs. an uninformed 50/50 baseline (Brier skill score): 1 = perfect,
 * 0 = no better than a coin flip, negative = worse than guessing. Null if empty
 * or degenerate. Useful as a single honest headline number.
 */
export function brierSkillScore(items: CalibrationItem[]): number | null {
  const brier = brierScore(items);
  if (brier == null) return null;
  const base = items.reduce((s, it) => s + (0.5 - (it.hit ? 1 : 0)) ** 2, 0) / items.length; // = 0.25
  if (base === 0) return null;
  return round4(1 - brier / base);
}

/** Reliability curve: predicted vs. realized rate per probability band. */
export interface ReliabilityBucket {
  bucket: string; // e.g. "50-60%"
  predicted: number; // mean predicted prob in band, 0..100
  actual: number; // realized hit rate, 0..100
  count: number;
}

export function reliabilityCurve(
  items: CalibrationItem[],
  edges: number[] = [0, 0.5, 0.6, 0.7, 0.8, 1.01],
): ReliabilityBucket[] {
  const out: ReliabilityBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const inBand = items.filter((it) => it.p >= lo && it.p < hi);
    const hits = inBand.filter((it) => it.hit).length;
    out.push({
      bucket: `${Math.round(lo * 100)}-${Math.round(Math.min(hi, 1) * 100)}%`,
      predicted:
        inBand.length > 0
          ? round1((inBand.reduce((s, it) => s + it.p, 0) / inBand.length) * 100)
          : round1(((lo + Math.min(hi, 1)) / 2) * 100),
      actual: inBand.length > 0 ? round1((hits / inBand.length) * 100) : 0,
      count: inBand.length,
    });
  }
  return out;
}

// ---- Closing Line Value ----

/** Entry & closing no-vig probability of the chosen side. */
export interface CLVItem {
  entryProb: number;
  closingProb: number;
  won?: boolean; // optional: settled outcome, to correlate CLV with results
}

export interface CLVSummary {
  count: number; // items with both entry & closing captured
  avgClv: number; // mean (closing − entry) in percentage points
  beatCloseRate: number; // % of picks where the market moved toward our side
  positive: number;
  negative: number;
  neutral: number;
}

/**
 * CLV = closing prob − entry prob (in percentage points). Positive means the
 * market moved *toward* your side after you took it — the strongest leading
 * indicator that a pick had genuine edge, independent of the single-game result.
 */
export function clvSummary(items: CLVItem[]): CLVSummary {
  const valid = items.filter((it) => Number.isFinite(it.entryProb) && Number.isFinite(it.closingProb));
  if (valid.length === 0) {
    return { count: 0, avgClv: 0, beatCloseRate: 0, positive: 0, negative: 0, neutral: 0 };
  }
  let sum = 0;
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  for (const it of valid) {
    const clv = it.closingProb - it.entryProb;
    sum += clv;
    if (clv > 0.0005) positive++;
    else if (clv < -0.0005) negative++;
    else neutral++;
  }
  return {
    count: valid.length,
    avgClv: round2((sum / valid.length) * 100),
    beatCloseRate: round1((positive / valid.length) * 100),
    positive,
    negative,
    neutral,
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function round1(x: number) {
  return Math.round(x * 10) / 10;
}
function round2(x: number) {
  return Math.round(x * 100) / 100;
}
function round4(x: number) {
  return Math.round(x * 10000) / 10000;
}
