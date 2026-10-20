import type { Prisma } from "@prisma/client";
import type { Direction } from "@/types";
import { consensusProbOver, type ConsensusModel } from "@/lib/analysis/marketConsensus";
import { readVenueLine } from "@/lib/analysis/venues";
import { edgeSourceFor } from "@/lib/analysis/marketSkill";
import type { MarketSnapshot } from "@/lib/marketSnapshot";

/**
 * Rows for the forecast log (PropPrediction), pure. Every prop the live model
 * scores gets one per scoring run — the forecast as of that moment — so the
 * model can be scored against the market on all priced props, not just picks.
 */

/** The backfilled baseline. Never pooled with live rows. */
export const BASELINE_V0 = "baseline-v0 (nflverse logs, no context)";

export type MarketMethod = "consensus-v2" | "novig-v1";

/** consensus-v2 when per-book quotes are stored (from 2026-10-01); novig-v1 for older single-probability rows. */
export function marketMethodOf(snapshot: MarketSnapshot | null): MarketMethod {
  return snapshot?.quotes?.length ? "consensus-v2" : "novig-v1";
}

export interface PreviousForecast {
  playerStatus: string | null;
  teammateOut: boolean | null;
}

/** P(over) from a probability for one side. */
export function overProb(sideProb: number, direction: Direction): number {
  return direction === "OVER" ? sideProb : 1 - sideProb;
}

export function buildLivePrediction(input: {
  prop: { id: string; line: number; underdogLine: number | null; direction: string; updatedAt: Date };
  modelProbability: number | null | undefined;
  modelRawProbability: number | null | undefined;
  consensus: ConsensusModel | null;
  snapshot: MarketSnapshot | null;
  playerStatus: string | null;
  teammateOut: boolean | null;
  previous: PreviousForecast | null;
  modelVersion: string;
}): Prisma.PropPredictionCreateManyInput | null {
  const { prop, consensus } = input;
  if (input.modelProbability == null || !consensus) return null;
  const direction = prop.direction as Direction;
  // The line the live model scored — Underdog's once known, else the books'.
  const line = prop.underdogLine ?? prop.line;
  const venueFlag = prop.underdogLine != null ? readVenueLine(consensus, prop.underdogLine, direction).flag : null;
  return {
    playerPropId: prop.id,
    quotedAt: input.snapshot?.fetchedAt ? new Date(input.snapshot.fetchedAt) : prop.updatedAt,
    line,
    lineKind: prop.underdogLine != null ? "venue" : "reference",
    modelProbOver: overProb(input.modelProbability, direction),
    modelRawProbOver: input.modelRawProbability != null ? overProb(input.modelRawProbability, direction) : null,
    marketProbOver: consensusProbOver(consensus, line),
    marketMethod: marketMethodOf(input.snapshot),
    modelVersion: input.modelVersion,
    source: "live",
    edgeSource: edgeSourceFor({ venueFlag, previous: input.previous, playerStatus: input.playerStatus, teammateOut: input.teammateOut }),
    playerStatus: input.playerStatus,
    teammateOut: input.teammateOut,
  };
}
