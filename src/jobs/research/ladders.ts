/**
 * The books' alternate ladders in the odds store, with each ladder's main-line
 * quotes, for the σ fit and its held-out price test. Research jobs only.
 *
 * Main lines come from the store's slate quotes as they stood when the ladder
 * was fetched: the latest slate fetch at or before it — never a later one,
 * and never several fetch times mixed. Ladders fetched before the store kept
 * slate quotes (the fit's own 2026-10-17 ladders) fall back to the prop's
 * stored snapshot.
 */
import { prisma } from "@/lib/db/client";
import { parseSnapshot } from "@/lib/marketSnapshot";
import { devigLadder, type Ladder } from "@/lib/analysis/consensusSpread";
import type { RawQuote } from "@/lib/analysis/marketConsensus";
import { teamsMatch } from "@/lib/utils/teamName";

/** The day of the alt fetch that FITTED_SPREAD_PARAMS was fitted on; later ladders are held out. */
export const FIT_LADDER_DAY = "2026-10-17";

export interface StoredLadder extends Ladder {
  /** UTC day of the ladder's fetch. */
  day: string;
  /** The game (event id): the cluster for bootstrap intervals. */
  game: string;
}

export async function loadLadders(): Promise<{ ladders: StoredLadder[]; noMain: number }> {
  const alt = await prisma.oddsQuote.findMany({ where: { fetchKind: "alt" }, orderBy: [{ fetchedAt: "asc" }, { id: "asc" }] });
  const groups = new Map<string, typeof alt>();
  for (const q of alt) {
    // One ladder per player prop per alt fetch.
    const k = `${q.eventId}|${q.playerName}|${q.propType}|${q.fetchedAt.getTime()}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(q);
  }
  const ladders: StoredLadder[] = [];
  let noMain = 0;
  for (const qs of groups.values()) {
    const { eventId, playerName, propType, homeTeam, awayTeam, commenceTime, fetchedAt } = qs[0];
    const slate = await prisma.oddsQuote.findMany({
      where: { fetchKind: "slate", eventId, playerName, propType, fetchedAt: { lte: fetchedAt } },
      orderBy: [{ fetchedAt: "desc" }, { id: "asc" }],
    });
    const latest = slate[0]?.fetchedAt.getTime();
    let main: RawQuote[] = slate.filter((q) => q.fetchedAt.getTime() === latest).map((q) => ({ book: q.book, line: q.line, over: q.over, under: q.under }));
    if (main.length === 0) {
      const day = 86_400_000;
      const props = await prisma.playerProp.findMany({
        where: { playerName, propType, isDemo: false, gameStartTime: { gte: new Date(commenceTime.getTime() - day), lte: new Date(commenceTime.getTime() + day) } },
        orderBy: { id: "asc" },
      });
      const prop = props.find((p) => teamsMatch(p.team, homeTeam) && teamsMatch(p.opponent, awayTeam));
      main = parseSnapshot(prop?.marketDataJson)?.quotes?.map((q) => ({ book: q.book, line: q.line, over: q.over, under: q.under })) ?? [];
    }
    if (main.length === 0) {
      noMain++;
      continue;
    }
    const rungs = devigLadder(main, qs.map((q) => ({ book: q.book, line: q.line, over: q.over })));
    if (rungs.length) ladders.push({ propType, main, rungs, day: fetchedAt.toISOString().slice(0, 10), game: eventId });
  }
  return { ladders, noMain };
}
