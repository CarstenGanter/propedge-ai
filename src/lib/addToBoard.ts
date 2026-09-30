import "server-only";
import type { PlayerProp } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";
import { analyzeProp } from "@/lib/analysis/scoringEngine";
import { buildResearchBundle, resolveProviderContext } from "@/lib/providers";
import { clvEntryProb, pickCreateData, propToScorable } from "@/lib/generate";
import type { Direction } from "@/types";

/**
 * Score one game's props, or put a single prop on the board, without a re-rank.
 *
 * The board keeps the top N picks for the whole day, so a night game can miss it
 * entirely even though its props were fetched and paid for. A re-rank is the
 * wrong tool once any game has started: it rebuilds every pending pick. This
 * scores props already stored — free, no Odds API call — and adds one pick at a
 * time, leaving everything else on the board untouched.
 */

export interface ScoredProp {
  propId: string;
  playerName: string;
  propType: string;
  direction: Direction;
  line: number;
  /** Model probability of this side, 0..100 (a probability under the distribution profile). */
  model: number;
  /** Market no-vig probability of this side, 0..100, when books priced it. */
  market: number | null;
  books: number | null;
  onBoard: boolean;
  out: boolean;
  firstWarning: string | null;
}

async function score(prop: PlayerProp, settings: Awaited<ReturnType<typeof getSettings>>) {
  const ctx = resolveProviderContext({
    propIsDemo: prop.isDemo,
    demoMode: settings.demoMode,
    enableWebResearch: settings.enableWebResearch,
  });
  const scorable = propToScorable(prop);
  const bundle = await buildResearchBundle(scorable, ctx);
  const analysis = analyzeProp(scorable, bundle, { profile: settings.scoringProfile });
  const entryProb = clvEntryProb(bundle.market?.probOverAtLine ?? bundle.market?.noVigProbOver, prop.direction as Direction);
  return { bundle, analysis, entryProb };
}

/** Every stored prop for one game, scored and ranked. Reads only; writes nothing but caches. */
export async function scoreGameProps(date: string, gameId: string): Promise<ScoredProp[]> {
  const settings = await getSettings();
  const props = await prisma.playerProp.findMany({
    where: { date, gameId, status: "pending" },
    include: { picks: { select: { id: true } } },
  });
  const out: ScoredProp[] = [];
  for (const prop of props) {
    const { bundle, analysis, entryProb } = await score(prop, settings);
    out.push({
      propId: prop.id,
      playerName: prop.playerName,
      propType: prop.propType,
      direction: prop.direction as Direction,
      line: prop.underdogLine ?? prop.line,
      model: analysis.confidenceScore,
      market: entryProb == null ? null : Math.round(entryProb * 1000) / 10,
      books: bundle.market?.bookCount ?? null,
      onBoard: prop.picks.length > 0,
      out: bundle.news?.playerStatus === "out",
      firstWarning: analysis.warnings[0] ?? null,
    });
  }
  return out.sort((a, b) => b.model - a.model || a.playerName.localeCompare(b.playerName));
}

/** Put one prop on the board as a pick, ranked after everything already there. */
export async function addPropToBoard(propId: string): Promise<{ ok: boolean; pickId?: string; error?: string }> {
  const prop = await prisma.playerProp.findUnique({ where: { id: propId }, include: { picks: { select: { id: true } } } });
  if (!prop) return { ok: false, error: "Prop not found." };
  if (prop.picks.length > 0) return { ok: true, pickId: prop.picks[0].id }; // already on the board

  const settings = await getSettings();
  const { bundle, analysis, entryProb } = await score(prop, settings);

  // Remember whose team the player is on — the two-team slip rule depends on it.
  const teamId = bundle.playerStats?.playerTeamId;
  if (teamId && teamId !== prop.playerTeamId) {
    await prisma.playerProp.update({ where: { id: prop.id }, data: { playerTeamId: teamId } });
  }

  const last = await prisma.pick.aggregate({ where: { date: prop.date }, _max: { rank: true } });
  const created = await prisma.pick.create({
    data: pickCreateData(prop, analysis, entryProb, (last._max.rank ?? 0) + 1, settings),
  });
  return { ok: true, pickId: created.id };
}
