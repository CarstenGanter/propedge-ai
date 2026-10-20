/**
 * The news-edge test: after a player's status changes to Out, how many minutes
 * until each venue (Underdog, PrizePicks, each sportsbook group) moves his
 * teammates' lines?
 *
 *   npm run research:latency
 *
 * Status changes come from InjuryStatusChange (logged every ~15 minutes by the
 * schedulers); quotes from the odds store. Only genuine changes count — from
 * questionable, doubtful or active to out — not a player's first appearance on
 * the report. Resolution is our fetch cadence: today a slate fetch in the
 * morning and a closing capture 20–60 minutes before kickoff (games with picks
 * only), so most moves are bracketed to hours, and a venue that had not moved
 * by our last look is reported as "at least" that long.
 */
import { prisma } from "@/lib/db/client";
import { bookMoves, latencyByGroup, type BookMove, type TimedQuote } from "@/lib/analysis/newsLatency";
import { resolveEspnAthlete } from "@/lib/providers/live/espnPlayerStats";
import { teamsMatch } from "@/lib/utils/teamName";

const fmt = (x: number | null) => (x == null ? "—" : `${Math.round(x)} min`);

async function main() {
  const changes = await prisma.injuryStatusChange.findMany({
    where: { toStatus: "out", fromStatus: { not: null, notIn: ["out"] } },
    orderBy: { detectedAt: "asc" },
  });
  const firstSightings = await prisma.injuryStatusChange.count({ where: { fromStatus: null } });
  console.log(`Status changes to Out: ${changes.length} (plus ${firstSightings} first sightings, not counted).`);

  const all: BookMove[] = [];
  let measured = 0;
  for (const c of changes) {
    const window = 3 * 3_600_000;
    const candidates = await prisma.oddsQuote.findMany({
      where: { fetchKind: { in: ["slate", "closing"] }, commenceTime: { gte: new Date(c.kickoff.getTime() - window), lte: new Date(c.kickoff.getTime() + window) } },
    });
    const event = candidates.find((q) => teamsMatch(q.homeTeam, c.team) || teamsMatch(q.awayTeam, c.team));
    if (!event) {
      console.log(`  ${c.detectedAt.toISOString()} ${c.playerName} (${c.team}): no stored quotes for that game`);
      continue;
    }
    const quotes = candidates.filter((q) => q.eventId === event.eventId && q.playerName !== c.playerName);
    const teammates = new Set<string>();
    for (const name of new Set(quotes.map((q) => q.playerName))) {
      const ref = await resolveEspnAthlete("NFL", name, event.homeTeam, event.awayTeam);
      if (ref && teamsMatch(ref.teamName, c.team)) teammates.add(name);
    }
    const timed: TimedQuote[] = quotes
      .filter((q) => teammates.has(q.playerName))
      .map((q) => ({ book: q.book, key: `${q.playerName}|${q.propType}`, line: q.line, over: q.over, under: q.under, fetchedAt: q.fetchedAt, bookUpdatedAt: q.bookUpdatedAt }));
    const moves = bookMoves(timed, c.detectedAt);
    if (moves.length === 0) {
      console.log(`  ${c.detectedAt.toISOString()} ${c.playerName} (${c.team}): no teammate quote both before and after the news`);
      continue;
    }
    measured++;
    all.push(...moves);
    console.log(`\n  ${c.detectedAt.toISOString()} ${c.playerName} (${c.team}) ${c.fromStatus} → out — ${teammates.size} teammates with props`);
    for (const g of latencyByGroup(moves)) {
      console.log(`    ${g.group.padEnd(12)} ${g.moved}/${g.props} moved; median ${fmt(g.medianMinutes)} (book's own stamp ${fmt(g.medianBookMinutes)})${g.censoredAtLeast != null ? `; unmoved at ≥ ${fmt(g.censoredAtLeast)}` : ""}`);
    }
  }

  console.log(`\nAcross ${measured} measurable change(s):`);
  if (all.length === 0) {
    console.log("  nothing to measure yet — needs a change to Out between two stored fetches of that game.");
  } else {
    for (const g of latencyByGroup(all)) {
      console.log(`  ${g.group.padEnd(12)} ${g.moved}/${g.props} teammate props moved; median ${fmt(g.medianMinutes)} (book's own stamp ${fmt(g.medianBookMinutes)})${g.censoredAtLeast != null ? `; unmoved ones looked at ≥ ${fmt(g.censoredAtLeast)}` : ""}`);
    }
  }
  await prisma.$disconnect();
}

main();
