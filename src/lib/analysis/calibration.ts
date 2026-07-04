import type { PickRecord } from "@/lib/analytics";

export interface CalibrationPoint {
  bucket: string; // e.g. "70-79"
  predicted: number; // avg predicted confidence (0..100)
  actual: number; // actual hit rate (0..100)
  count: number; // decided picks in bucket
}

const BUCKETS: [number, number, string][] = [
  [0, 60, "Below 60"],
  [60, 70, "60-69"],
  [70, 80, "70-79"],
  [80, 90, "80-89"],
  [90, 101, "90-100"],
];

/**
 * Compare predicted confidence to realized hit rate per bucket. Only decided
 * picks (hit/miss) count — pushes/voids/pending are excluded.
 */
export function computeCalibration(picks: PickRecord[]): CalibrationPoint[] {
  return BUCKETS.map(([lo, hi, label]) => {
    const inBucket = picks.filter(
      (p) =>
        (p.status === "hit" || p.status === "miss") &&
        p.confidenceScore >= lo &&
        p.confidenceScore < hi,
    );
    const hits = inBucket.filter((p) => p.status === "hit").length;
    const predicted =
      inBucket.length > 0
        ? inBucket.reduce((s, p) => s + p.confidenceScore, 0) / inBucket.length
        : (lo + Math.min(hi, 100)) / 2;
    const actual = inBucket.length > 0 ? (hits / inBucket.length) * 100 : 0;
    return {
      bucket: label,
      predicted: Math.round(predicted * 10) / 10,
      actual: Math.round(actual * 10) / 10,
      count: inBucket.length,
    };
  });
}

/** Recent performance trend: rolling hit-rate over the last N decided picks by date. */
export function recentTrend(
  picks: PickRecord[],
  windowSize = 10,
): { date: string; hitRate: number }[] {
  const decided = picks
    .filter((p) => p.status === "hit" || p.status === "miss")
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; hitRate: number }[] = [];
  for (let i = 0; i < decided.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = decided.slice(start, i + 1);
    const hits = window.filter((p) => p.status === "hit").length;
    out.push({
      date: decided[i].date,
      hitRate: Math.round((hits / window.length) * 1000) / 10,
    });
  }
  return out;
}
