import type { SettlementStatus } from "@/types";

/**
 * Does line shopping actually work?
 *
 * In fixed-multiplier pick'em the structural edge is supposed to come from the
 * pick'em site posting a softer number than the sharp books. That is a claim,
 * not a fact, and it is measurable: record how often the two lines differ, in
 * which direction, and whether a favourable difference actually predicts hits.
 *
 * If the lines are usually identical, there is no edge to harvest and no amount
 * of model work will create one — so this is the most decision-relevant thing
 * the app can measure, and it is worth measuring honestly.
 */

export type EdgeBucket = "softer" | "identical" | "tougher";

/** Lines within this many units are treated as the same number. */
export const LINE_EPSILON = 0.001;

export interface LineEdgeInput {
  /** The line actually played. */
  underdogLine: number;
  /** The sharp market's consensus line. */
  marketLine: number;
  direction: "OVER" | "UNDER";
  status: SettlementStatus;
  propType: string;
}

/**
 * Signed edge in stat units: positive means the played line is easier to beat
 * than the market's. For an OVER a lower line is better; for an UNDER, higher.
 */
export function signedEdge(input: Pick<LineEdgeInput, "underdogLine" | "marketLine" | "direction">): number {
  const sign = input.direction === "OVER" ? 1 : -1;
  return sign * (input.marketLine - input.underdogLine);
}

export function bucketFor(edge: number): EdgeBucket {
  if (Math.abs(edge) < LINE_EPSILON) return "identical";
  return edge > 0 ? "softer" : "tougher";
}

export interface EdgeRecord {
  bucket: EdgeBucket;
  count: number;
  hits: number;
  misses: number;
  /** Hit rate over decided picks, or null when nothing has settled. */
  hitRate: number | null;
}

export interface LineEdgeSummary {
  /** Props where a played line was recorded at all. */
  total: number;
  buckets: Record<EdgeBucket, EdgeRecord>;
  /** Share of props where the two lines matched exactly. */
  identicalShare: number | null;
  /** Mean signed edge across every recorded prop, in stat units. */
  averageEdge: number | null;
  /**
   * True only when there is enough settled evidence to say anything. Well short
   * of this, the summary is descriptive and must not be read as a verdict.
   */
  conclusive: boolean;
}

/** Decided picks needed before the hit-rate comparison means anything at all. */
export const MIN_DECIDED_FOR_SIGNAL = 30;

function emptyRecord(bucket: EdgeBucket): EdgeRecord {
  return { bucket, count: 0, hits: 0, misses: 0, hitRate: null };
}

export function summarizeLineEdge(inputs: LineEdgeInput[]): LineEdgeSummary {
  const buckets: Record<EdgeBucket, EdgeRecord> = {
    softer: emptyRecord("softer"),
    identical: emptyRecord("identical"),
    tougher: emptyRecord("tougher"),
  };
  let edgeSum = 0;
  for (const i of inputs) {
    const e = signedEdge(i);
    edgeSum += e;
    const b = buckets[bucketFor(e)];
    b.count++;
    if (i.status === "hit") b.hits++;
    else if (i.status === "miss") b.misses++;
  }
  for (const b of Object.values(buckets)) {
    const decided = b.hits + b.misses;
    b.hitRate = decided > 0 ? (b.hits / decided) * 100 : null;
  }
  const decidedTotal = Object.values(buckets).reduce((s, b) => s + b.hits + b.misses, 0);
  return {
    total: inputs.length,
    buckets,
    identicalShare: inputs.length > 0 ? buckets.identical.count / inputs.length : null,
    averageEdge: inputs.length > 0 ? edgeSum / inputs.length : null,
    conclusive: decidedTotal >= MIN_DECIDED_FOR_SIGNAL && buckets.softer.hits + buckets.softer.misses >= 10,
  };
}
