import "server-only";
import { prisma } from "@/lib/db/client";
import { generatePicksForDate } from "@/lib/generate";
import { settlePickById } from "@/lib/settle";
import { settleSingle } from "@/lib/settlement";
import { teamParlayOdds } from "@/lib/analysis/teamParlay";
import { getSettings } from "@/lib/settings";
import { addDaysToSlate, todaySlate } from "@/lib/utils/dates";
import { seededRng } from "@/lib/providers/prng";
import type { Direction } from "@/types";

interface DemoPropDef {
  sport: string;
  league: string;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: number;
  direction: Direction;
  payoutMultiplier?: number;
}

// Recognizable names paired with SYNTHETIC lines. Every row is flagged isDemo and
// labeled "Demo data" throughout the UI — no real stats are represented as real.
const ROSTER: DemoPropDef[] = [
  { sport: "NBA", league: "NBA", playerName: "Jalen Brunson", team: "Knicks", opponent: "Celtics", propType: "Points", line: 25.5, direction: "OVER" },
  { sport: "NBA", league: "NBA", playerName: "Nikola Jokic", team: "Nuggets", opponent: "Suns", propType: "Rebounds", line: 12.5, direction: "OVER" },
  { sport: "NBA", league: "NBA", playerName: "Luka Doncic", team: "Mavericks", opponent: "Clippers", propType: "Pts+Reb+Ast", line: 58.5, direction: "OVER" },
  { sport: "NBA", league: "NBA", playerName: "Tyrese Haliburton", team: "Pacers", opponent: "Bucks", propType: "Assists", line: 10.5, direction: "UNDER" },
  { sport: "NFL", league: "NFL", playerName: "Patrick Mahomes", team: "Chiefs", opponent: "Bills", propType: "Passing Yards", line: 274.5, direction: "OVER" },
  { sport: "NFL", league: "NFL", playerName: "Christian McCaffrey", team: "49ers", opponent: "Seahawks", propType: "Rushing Yards", line: 88.5, direction: "OVER" },
  { sport: "NFL", league: "NFL", playerName: "CeeDee Lamb", team: "Cowboys", opponent: "Eagles", propType: "Receiving Yards", line: 79.5, direction: "UNDER" },
  { sport: "MLB", league: "MLB", playerName: "Aaron Judge", team: "Yankees", opponent: "Red Sox", propType: "Total Bases", line: 1.5, direction: "OVER" },
  { sport: "MLB", league: "MLB", playerName: "Shohei Ohtani", team: "Dodgers", opponent: "Padres", propType: "Hits", line: 1.5, direction: "OVER" },
  { sport: "MLB", league: "MLB", playerName: "Gerrit Cole", team: "Yankees", opponent: "Orioles", propType: "Strikeouts", line: 6.5, direction: "OVER" },
  { sport: "NHL", league: "NHL", playerName: "Auston Matthews", team: "Maple Leafs", opponent: "Bruins", propType: "Shots on Goal", line: 4.5, direction: "OVER" },
  { sport: "NHL", league: "NHL", playerName: "Connor McDavid", team: "Oilers", opponent: "Flames", propType: "Points", line: 1.5, direction: "OVER" },
  { sport: "WNBA", league: "WNBA", playerName: "A'ja Wilson", team: "Aces", opponent: "Liberty", propType: "Points", line: 24.5, direction: "OVER" },
  { sport: "WNBA", league: "WNBA", playerName: "Breanna Stewart", team: "Liberty", opponent: "Aces", propType: "Rebounds", line: 8.5, direction: "UNDER" },
  { sport: "NCAAB", league: "NCAAB", playerName: "Demo Guard", team: "Blue", opponent: "Cardinal", propType: "Points", line: 18.5, direction: "OVER" },
  { sport: "Soccer", league: "MLS", playerName: "Lionel Messi", team: "Inter Miami", opponent: "Orlando City", propType: "Shots on Target", line: 1.5, direction: "OVER" },
];

async function clearDemoData() {
  // Cascades remove evidence, legs, and bankroll entries tied to demo picks/props.
  await prisma.bankrollEntry.deleteMany({ where: { isDemo: true } });
  await prisma.parlay.deleteMany({ where: { isDemo: true } });
  await prisma.teamParlay.deleteMany({ where: { isDemo: true } });
  await prisma.pick.deleteMany({ where: { isDemo: true } });
  await prisma.playerProp.deleteMany({ where: { isDemo: true } });
  await prisma.teamPick.deleteMany({ where: { isDemo: true } });
}

/** One demo moneyline parlay from today's pending demo team picks. */
async function seedDemoTeamParlay(today: string, defaultStake: number): Promise<number> {
  const legs = await prisma.teamPick.findMany({
    where: { date: today, status: "pending", isDemo: true },
    orderBy: { rank: "asc" },
    take: 3,
  });
  if (legs.length < 2) return 0;
  const odds = teamParlayOdds(legs.map((p) => ({ priceAmerican: p.priceAmerican })), defaultStake);
  const parlay = await prisma.teamParlay.create({
    data: {
      date: today,
      name: `Demo ${legs.length}-team ML`,
      stake: defaultStake,
      combinedDecimal: odds.combinedDecimal,
      combinedAmerican: odds.combinedAmerican,
      projectedPayout: odds.projectedPayout,
      isDemo: true,
      legs: { create: legs.map((p) => ({ teamPickId: p.id, priceAmerican: p.priceAmerican, status: "pending" })) },
    },
  });
  await prisma.bankrollEntry.create({
    data: { date: today, teamParlayId: parlay.id, entryType: "team_parlay", stake: defaultStake, status: "pending", isDemo: true },
  });
  return 1;
}

// Recognizable matchups paired with SYNTHETIC probabilities (labeled demo).
const DEMO_GAMES: { league: string; home: string; away: string; threeWay: boolean }[] = [
  { league: "MLB", home: "New York Yankees", away: "Boston Red Sox", threeWay: false },
  { league: "MLB", home: "Los Angeles Dodgers", away: "San Diego Padres", threeWay: false },
  { league: "WNBA", home: "Las Vegas Aces", away: "New York Liberty", threeWay: false },
  { league: "EPL", home: "Manchester City", away: "Arsenal", threeWay: true },
];

function priceFromProb(p: number): number {
  // fair American price from a win probability
  return p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}

async function seedDemoTeams(date: string, isToday: boolean, defaultStake: number): Promise<{ settled: number; bankroll: number }> {
  let settled = 0;
  let bankroll = 0;
  let rank = 1;
  for (const g of DEMO_GAMES) {
    const rng = seededRng(`${g.home}|${g.away}|${date}|team`);
    const marketProb = 0.52 + rng() * 0.28; // home favored 52%-80%
    const winProb = Math.min(0.95, Math.max(0.4, marketProb + (rng() - 0.45) * 0.08));
    const valueEdge = Math.round((winProb - marketProb) * 1000) / 1000;
    const price = priceFromProb(marketProb);
    const confidence = Math.round(50 + (winProb - 0.5) * 80);
    const risk = confidence >= 66 ? "Low" : confidence >= 58 ? "Medium" : "High";

    let status = "pending";
    let actualWinner: string | null = null;
    if (!isToday) {
      const r = seededRng(`${g.home}|${date}|result`)();
      const homeWon = r < winProb;
      actualWinner = homeWon ? "HOME" : "AWAY";
      status = homeWon ? "win" : "loss";
      settled++;
    }

    const pick = await prisma.teamPick.create({
      data: {
        date,
        league: g.league,
        homeTeam: g.home,
        awayTeam: g.away,
        gameStartTime: new Date(`${date}T23:00:00Z`),
        recommendedSide: "HOME",
        recommendedTeam: g.home,
        winProbability: Math.round(winProb * 1000) / 1000,
        marketWinProb: Math.round(marketProb * 1000) / 1000,
        valueEdge,
        priceAmerican: price,
        confidenceScore: confidence,
        edgeScore: Math.round(valueEdge * 1000) / 10,
        riskLevel: risk,
        rank: rank++,
        reasoningSummary: `Demo: ${g.home} to win ${Math.round(winProb * 100)}% vs ${Math.round(marketProb * 100)}% market.`,
        verdict: `Verdict: lean ${g.home}. Demo data.`,
        scoreBreakdownJson: JSON.stringify({ marketProb: confidence, form: 55, injuries: 50, homeAdvantage: 60, value: 50 + valueEdge * 400 }),
        evidenceJson: JSON.stringify([{ category: "marketProb", title: "Demo market", summary: "Synthetic demo probability.", confidenceImpact: 5, sourceName: "Demo data" }]),
        tagsJson: JSON.stringify(valueEdge >= 0.03 ? ["value", "home"] : ["home"]),
        status,
        actualWinner,
        isDemo: true,
        modelVersion: "team-v1.0.0",
      },
    });

    if (!isToday && seededRng(`${pick.id}|bet`)() < 0.5) {
      const won = status === "win";
      const profit = won ? Math.round(((price > 0 ? defaultStake * (price / 100) : defaultStake * (100 / Math.abs(price)))) * 100) / 100 : -defaultStake;
      await prisma.bankrollEntry.create({
        data: {
          date,
          teamPickId: pick.id,
          entryType: "moneyline",
          stake: defaultStake,
          payout: won ? Math.round((defaultStake + profit) * 100) / 100 : 0,
          profitLoss: profit,
          status: won ? "won" : "lost",
          isDemo: true,
        },
      });
      bankroll++;
    }
  }
  return { settled, bankroll };
}

async function insertDemoProps(date: string) {
  await prisma.playerProp.createMany({
    data: ROSTER.map((r) => ({
      date,
      sport: r.sport,
      league: r.league,
      playerName: r.playerName,
      team: r.team,
      opponent: r.opponent,
      propType: r.propType,
      line: r.line,
      direction: r.direction,
      source: "Demo data",
      payoutMultiplier: r.payoutMultiplier ?? null,
      isDemo: true,
      gameStartTime: new Date(`${date}T23:00:00Z`),
    })),
  });
}

/** Synthetic, date-seeded stat result so historical demo picks vary day to day. */
function syntheticResult(player: string, propType: string, line: number, date: string): number {
  const rng = seededRng(`${player}|${propType}|${date}|actual`);
  const noise = (rng() - 0.45) * line * 0.6;
  return Math.max(0, Math.round((line + noise) * 10) / 10);
}

export interface DemoSeedSummary {
  days: number;
  props: number;
  settledPicks: number;
  bankrollEntries: number;
  parlays: number;
  teamPicks: number;
}

/**
 * Populate ~14 days of demo history plus today's slate: props, ranked picks,
 * settled results, bankroll entries and a couple of parlays.
 */
export async function seedDemoData(historyDays = 14): Promise<DemoSeedSummary> {
  await clearDemoData();
  const settings = await getSettings();
  const today = todaySlate();

  let settledPicks = 0;
  let bankrollEntries = 0;
  let parlays = 0;
  let propCount = 0;

  const dates: string[] = [];
  for (let i = historyDays; i >= 0; i--) dates.push(addDaysToSlate(today, -i));

  for (const date of dates) {
    await insertDemoProps(date);
    propCount += ROSTER.length;
    await generatePicksForDate(date);

    if (date === today) continue; // leave today's picks pending

    const picks = await prisma.pick.findMany({
      where: { date, status: "pending" },
      include: { playerProp: true },
    });

    const settledForParlay: { id: string; status: string }[] = [];
    for (const pick of picks) {
      const actual = syntheticResult(
        pick.playerProp.playerName,
        pick.playerProp.propType,
        pick.playerProp.line,
        date,
      );
      await settlePickById(pick.id, { actualResult: actual });
      settledPicks++;

      const refreshed = await prisma.pick.findUnique({ where: { id: pick.id } });
      const status = refreshed?.status ?? "miss";
      settledForParlay.push({ id: pick.id, status });

      // Bet ~60% of picks as singles at the default stake.
      const rng = seededRng(`${pick.id}|bet`);
      if (rng() < 0.6) {
        const result = settleSingle(settings.defaultStake, status as never, pick.playerProp.payoutMultiplier ?? 2);
        await prisma.bankrollEntry.create({
          data: {
            date,
            pickId: pick.id,
            entryType: "single",
            stake: settings.defaultStake,
            payout: result.payout,
            profitLoss: result.profitLoss,
            status: result.status,
            isDemo: true,
          },
        });
        bankrollEntries++;
      }
    }

    // Build a small demo parlay every few days from that day's top legs.
    if (settledForParlay.length >= 3 && seededRng(`${date}|parlay`)() < 0.5) {
      await createDemoParlay(date, settledForParlay.slice(0, 3), settings.defaultStake);
      parlays++;
      bankrollEntries++;
    }
  }

  // Demo team picks (game winners) across the same date range.
  let teamPicks = 0;
  for (const date of dates) {
    const r = await seedDemoTeams(date, date === today, settings.defaultStake);
    teamPicks += DEMO_GAMES.length;
    bankrollEntries += r.bankroll;
  }

  // One demo moneyline parlay from today's pending team picks.
  const teamParlaysMade = await seedDemoTeamParlay(today, settings.defaultStake);
  bankrollEntries += teamParlaysMade;

  return { days: dates.length, props: propCount, settledPicks, bankrollEntries, parlays, teamPicks };
}

async function createDemoParlay(
  date: string,
  legs: { id: string; status: string }[],
  stake: number,
) {
  const multiplier = 6;
  const statuses = legs.map((l) => l.status);
  const allHit = statuses.every((s) => s === "hit");
  const anyMiss = statuses.some((s) => s === "miss");
  const status = anyMiss ? "lost" : allHit ? "won" : "void";
  const payout = status === "won" ? stake * multiplier : status === "void" ? stake : 0;
  const profitLoss = status === "won" ? payout - stake : status === "lost" ? -stake : 0;

  const parlay = await prisma.parlay.create({
    data: {
      date,
      name: `Demo ${date} 3-leg`,
      stake,
      payoutMultiplier: multiplier,
      projectedPayout: stake * multiplier,
      actualPayout: payout,
      profitLoss,
      status,
      isDemo: true,
      legs: { create: legs.map((l) => ({ pickId: l.id, status: l.status })) },
    },
  });
  await prisma.bankrollEntry.create({
    data: {
      date,
      parlayId: parlay.id,
      entryType: "parlay",
      stake,
      payout,
      profitLoss,
      status,
      isDemo: true,
    },
  });
}

export async function clearDemoDataPublic() {
  await clearDemoData();
}
