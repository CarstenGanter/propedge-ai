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
 * the report. Two readings per change:
 *   - from the last stored quote before the news: when each venue first moved
 *     (censored as "at least" when it had not moved by our last look);
 *   - for the news-fetch trial's events (fetched ~10 and ~40 minutes after the
 *     change): which venues were still moving between the two fetches, and
 *     each venue's gap to the books' line at each — the bracketed lag.
 * Friday's final injury report and game-day inactives are reported apart.
 */
import { prisma } from "@/lib/db/client";
import { bookMoves, latencyByGroup, PRICE_MOVE_PTS, propChangesBetween, summarizeChanges, venueGapsAtFetch, type BookMove, type PropChange, type TimedQuote, type VenueChange } from "@/lib/analysis/newsLatency";
import { buildConsensus } from "@/lib/analysis/marketConsensus";
import { classifyWindow } from "@/lib/nfl/newsFetchTrial";
import { NOT_NEWS_FROM } from "@/lib/nfl/injuryReport";
import { resolveEspnAthlete } from "@/lib/providers/live/espnPlayerStats";
import { teamsMatch } from "@/lib/utils/teamName";
import { emitSummary } from "@/lib/jobSummary";

const fmt = (x: number | null) => (x == null ? "—" : `${Math.round(x)} min`);
const signed = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}`);

function printGroups(moves: BookMove[], indent: string) {
  for (const g of latencyByGroup(moves)) {
    console.log(
      `${indent}${g.group.padEnd(12)} ${g.moved}/${g.props} moved; median ${fmt(g.medianMinutes)} (book's own stamp ${fmt(g.medianBookMinutes)})` +
        (g.censoredAtLeast != null ? `; unmoved at ≥ ${fmt(g.censoredAtLeast)}` : ""),
    );
  }
}

/** Each venue group's change between the two fetches, teammates beside the other team's control. */
function printChanges(treated: VenueChange[], control: VenueChange[], indent: string) {
  const fmtGroup = (g: VenueChange | undefined) =>
    g ? `${g.moved}/${g.props} moved, mean line ${g.meanLineChange == null ? "—" : `${g.meanLineChange >= 0 ? "+" : ""}${g.meanLineChange.toFixed(2)}`}` : "—";
  for (const group of [...new Set([...treated, ...control].map((g) => g.group))].sort()) {
    console.log(`${indent}${group.padEnd(12)} teammates ${fmtGroup(treated.find((g) => g.group === group)).padEnd(32)} other team ${fmtGroup(control.find((g) => g.group === group))}`);
  }
}

async function main() {
  const changes = await prisma.injuryStatusChange.findMany({
    // Real news only: not a first sighting, and not "cleared → out" (a player reappearing on a flapping report).
    where: { toStatus: "out", fromStatus: { not: null, notIn: [...NOT_NEWS_FROM] } },
    orderBy: { detectedAt: "asc" },
  });
  const firstSightings = await prisma.injuryStatusChange.count({ where: { fromStatus: null } });
  const trialRows = await prisma.newsFetch.findMany({ orderBy: [{ changeId: "asc" }, { seq: "asc" }] });
  console.log(`Status changes to Out: ${changes.length} (plus ${firstSightings} first sightings, not counted). Trial fetches: ${trialRows.filter((r) => r.status === "done").length} done, ${trialRows.filter((r) => r.status === "skipped").length} skipped, ${trialRows.reduce((s, r) => s + (r.creditsSpent ?? 0), 0)} credits spent.`);
  console.log(
    `News time = when our poll first saw the change (InjuryStatusChange.detectedAt, ~15-minute resolution), not the report's own time. ` +
      `A move = a line change, or a price change of at least ${PRICE_MOVE_PTS} points on a book's no-vig Over (venue prices are placeholders, so only their lines count).`,
  );

  // Main output: each venue's change between the trial's +10 and +40 minute
  // fetches, for the out player's teammates and — as a free comparison from the
  // same two fetches — the other team's props.
  const byWindow = new Map<string, { pre: BookMove[]; treated: PropChange[]; control: PropChange[]; events: number }>();
  for (const c of changes) {
    const fetches = trialRows.filter((r) => r.changeId === c.id && r.status === "done" && r.executedAt);
    const window = fetches[0]?.window ?? classifyWindow(c.detectedAt, c.kickoff) ?? "other";
    const bucket = byWindow.get(window) ?? byWindow.set(window, { pre: [], treated: [], control: [], events: 0 }).get(window)!;

    const span = 3 * 3_600_000;
    const candidates = await prisma.oddsQuote.findMany({
      where: { fetchKind: { in: ["slate", "closing", "news"] }, commenceTime: { gte: new Date(c.kickoff.getTime() - span), lte: new Date(c.kickoff.getTime() + span) } },
    });
    const event = candidates.find((q) => teamsMatch(q.homeTeam, c.team) || teamsMatch(q.awayTeam, c.team));
    if (!event) {
      console.log(`  ${c.detectedAt.toISOString()} ${c.playerName} (${c.team}) [${window}]: no stored quotes for that game`);
      continue;
    }
    const quotes = candidates.filter((q) => q.eventId === event.eventId && q.playerName !== c.playerName);
    const teammates = new Set<string>();
    const opponents = new Set<string>();
    for (const name of new Set(quotes.map((q) => q.playerName))) {
      const ref = await resolveEspnAthlete("NFL", name, event.homeTeam, event.awayTeam);
      if (!ref) continue;
      if (teamsMatch(ref.teamName, c.team)) teammates.add(name);
      else opponents.add(name);
    }
    const toTimed = (names: Set<string>): TimedQuote[] =>
      quotes
        .filter((q) => names.has(q.playerName))
        .map((q) => ({ book: q.book, key: `${q.playerName}|${q.propType}`, line: q.line, over: q.over, under: q.under, fetchedAt: q.fetchedAt, bookUpdatedAt: q.bookUpdatedAt }));
    const timed = toTimed(teammates);
    const control = toTimed(opponents);
    bucket.events++;
    console.log(`\n  ${c.detectedAt.toISOString()} ${c.playerName} (${c.team}) ${c.fromStatus} → out [${window}] — ${teammates.size} teammates with props`);

    if (fetches.length >= 2) {
      const [f1, f2] = fetches;
      const at = (qs: TimedQuote[], t: Date) => qs.filter((q) => q.fetchedAt.getTime() === t.getTime());
      const treated = propChangesBetween(at(timed, f1.executedAt!), at(timed, f2.executedAt!));
      const ctrl = propChangesBetween(at(control, f1.executedAt!), at(control, f2.executedAt!));
      bucket.treated.push(...treated);
      bucket.control.push(...ctrl);
      console.log(`    MAIN — change between the trial's fetches (+${fmt((f1.executedAt!.getTime() - c.detectedAt.getTime()) / 60_000)} → +${fmt((f2.executedAt!.getTime() - c.detectedAt.getTime()) / 60_000)}): teammates vs the other team`);
      printChanges(summarizeChanges(treated), summarizeChanges(ctrl), "      ");
      for (const f of [f1, f2]) {
        const at = timed.filter((q) => q.fetchedAt.getTime() === f.executedAt!.getTime());
        const gaps = venueGapsAtFetch(at, (propType, books) => buildConsensus(propType, books).model?.referenceLine ?? null);
        console.log(`    venue − books at fetch #${f.seq}:`);
        for (const g of gaps) {
          console.log(`      ${g.key.padEnd(36)} books ${g.books ?? "—"}  Underdog ${signed(g.underdog != null && g.books != null ? g.underdog - g.books : null)}  PrizePicks ${signed(g.prizepicks != null && g.books != null ? g.prizepicks - g.books : null)}`);
        }
      }
    }

    // Secondary: from the last stored quote before the news, which may be hours old.
    const pre = bookMoves(timed, c.detectedAt);
    bucket.pre.push(...pre);
    if (pre.length) {
      console.log("    secondary — from the last stored quote before the news (may be hours old, so drift counts too):");
      printGroups(pre, "      ");
    }
  }

  for (const window of ["friday", "inactives", "other"]) {
    const b = byWindow.get(window);
    if (!b) continue;
    console.log(`\n=== ${window === "friday" ? "Friday's final injury report" : window === "inactives" ? "Game-day inactives" : "Other times"} — ${b.events} event(s) ===`);
    if (b.treated.length || b.control.length) {
      console.log("  MAIN — change between the +10 and +40 fetches: teammates vs the other team");
      printChanges(summarizeChanges(b.treated), summarizeChanges(b.control), "    ");
    }
    if (b.pre.length) {
      console.log("  secondary — from the last stored quote before the news:");
      printGroups(b.pre, "    ");
    }
    if (!b.pre.length && !b.treated.length) console.log("  nothing measurable yet");
  }
  if (byWindow.size === 0) console.log("\nNothing to measure yet — needs a change to Out with stored quotes of that game around it.");
  emitSummary("latency", {
    changes: changes.length,
    trial: {
      done: trialRows.filter((r) => r.status === "done").length,
      skipped: trialRows.filter((r) => r.status === "skipped").length,
      credits: trialRows.reduce((s, r) => s + (r.creditsSpent ?? 0), 0),
    },
    windows: [...byWindow.entries()].map(([window, b]) => ({
      window,
      events: b.events,
      treated: summarizeChanges(b.treated),
      control: summarizeChanges(b.control),
      pre: latencyByGroup(b.pre),
    })),
  });
  await prisma.$disconnect();
}

main();
