import { clusterBootstrap, type Interval } from "./marketSkill";

/**
 * How well the books' probability read at the Underdog line predicts hits
 * (pure, tested). That number drives the Books column and so real decisions;
 * when the venue line differs from the books' line it is an extrapolation
 * along the consensus distribution, and this measures how good it is.
 */

export interface VenueItem {
  /** Books' probability of the side, read at the venue line. */
  p: number;
  hit: boolean;
  cluster: string;
  /** Venue line minus the books' line, signed so positive is easier for the side (stat units). */
  gap: number;
  /** False when the venue line is beyond what the books posted. */
  priced: boolean;
}

export interface CalibrationSummary {
  n: number;
  games: number;
  logLoss: number;
  brier: number;
  /** Expected calibration error over 5-point bins, in points. */
  ecePts: number;
}

function binOf(p: number, width: number): number {
  return Math.min(Math.floor(p / width), Math.round(1 / width) - 1);
}

export function calibrationSummary(items: VenueItem[], width = 0.05): CalibrationSummary | null {
  if (items.length === 0) return null;
  let ll = 0;
  let br = 0;
  const bins = new Map<number, { p: number; h: number; n: number }>();
  for (const it of items) {
    const q = Math.min(1 - 1e-6, Math.max(1e-6, it.p));
    ll += -Math.log(it.hit ? q : 1 - q);
    br += (it.p - (it.hit ? 1 : 0)) ** 2;
    const b = bins.get(binOf(it.p, width)) ?? { p: 0, h: 0, n: 0 };
    b.p += it.p;
    b.h += it.hit ? 1 : 0;
    b.n++;
    bins.set(binOf(it.p, width), b);
  }
  let ece = 0;
  for (const b of bins.values()) ece += (b.n / items.length) * Math.abs(b.h / b.n - b.p / b.n);
  return {
    n: items.length,
    games: new Set(items.map((i) => i.cluster)).size,
    logLoss: ll / items.length,
    brier: br / items.length,
    ecePts: ece * 100,
  };
}

export interface BucketRow {
  label: string;
  n: number;
  /** Mean books' probability, points. */
  predictedPts: number;
  /** Actual hit rate, points. */
  actualPts: number;
  /** Hits minus books-expected hits, per prop, points. */
  excessPts: number;
  excessInterval: Interval | null;
}

function excess(xs: VenueItem[]): number | null {
  if (xs.length === 0) return null;
  return (xs.reduce((s, i) => s + (i.hit ? 1 : 0) - i.p, 0) / xs.length) * 100;
}

function row(label: string, xs: VenueItem[], opts: { reps?: number; seed?: number }): BucketRow {
  return {
    label,
    n: xs.length,
    predictedPts: (xs.reduce((s, i) => s + i.p, 0) / xs.length) * 100,
    actualPts: (xs.filter((i) => i.hit).length / xs.length) * 100,
    excessPts: excess(xs)!,
    excessInterval: clusterBootstrap(xs, excess, opts),
  };
}

/** Reliability in bins of the books' probability (5 points by default). */
export function reliabilityTable(items: VenueItem[], width = 0.05, opts: { reps?: number; seed?: number } = {}): BucketRow[] {
  const groups = new Map<number, VenueItem[]>();
  for (const it of items) (groups.get(binOf(it.p, width)) ?? groups.set(binOf(it.p, width), []).get(binOf(it.p, width))!).push(it);
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([b, xs]) => row(`${Math.round(b * width * 100)}–${Math.round((b + 1) * width * 100)}%`, xs, opts));
}

/**
 * Venue-gap buckets, in stat units (display bins). Lines beyond the books' range
 * get their own bucket whatever their gap: that is where the 85% artifact lives.
 */
export function venueGapBucket(it: Pick<VenueItem, "gap" | "priced">): string {
  if (!it.priced) return "beyond the books' lines";
  if (it.gap <= -2) return "tough by 2+";
  if (it.gap < 0) return "tough by under 2";
  if (it.gap === 0) return "same line";
  if (it.gap < 2) return "soft by under 2";
  return "soft by 2+";
}

const BUCKET_ORDER = ["tough by 2+", "tough by under 2", "same line", "soft by under 2", "soft by 2+", "beyond the books' lines"];

export function excessByVenueGap(items: VenueItem[], opts: { reps?: number; seed?: number } = {}): BucketRow[] {
  const groups = new Map<string, VenueItem[]>();
  for (const it of items) {
    const k = venueGapBucket(it);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  return BUCKET_ORDER.filter((k) => groups.has(k)).map((k) => row(k, groups.get(k)!, opts));
}
