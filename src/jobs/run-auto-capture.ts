/**
 * Scheduled closing-line capture. Runs every 15 minutes on game days (see
 * scripts/install-auto-capture.sh) and captures NFL prop closing lines for any
 * game 20-60 minutes from kickoff, once per game.
 *
 * Almost every run exits without touching the network: the first check is a
 * local database count, the second a cached ESPN schedule read that is free.
 * Credits are only spent when a game with uncaptured picks is actually due —
 * the same spend as clicking "+ props" by hand, minus having to remember.
 *
 *   npm run capture:auto
 */
import { prisma } from "@/lib/db/client";
import { captureClosingLines } from "@/lib/captureLines";
import { getNflSlate } from "@/lib/nfl/schedule";
import { toNflSlateDate } from "@/lib/nfl/slate";
import { decideCapture, inCaptureWindow } from "@/lib/nfl/autoCapture";

async function main() {
  const now = new Date();
  const stamp = now.toISOString();
  const date = toNflSlateDate(stamp);

  const uncaptured = await prisma.pick.count({
    where: {
      date,
      status: "pending",
      isDemo: false,
      closingProb: null,
      playerProp: { sport: "NFL", source: "The Odds API" },
    },
  });

  // Only read the schedule when there is something that could need capturing.
  const kickoffs = uncaptured > 0 ? (await getNflSlate(date)).map((g) => g.kickoffISO) : [];
  const decision = decideCapture(uncaptured, kickoffs, now);

  if (decision.action === "skip") {
    console.log(`[${stamp}] ${date}: skip — ${decision.reason}`);
    return;
  }

  console.log(`[${stamp}] ${date}: capturing ${decision.kickoffs.length} game(s), ${uncaptured} uncaptured pick(s)`);
  const r = await captureClosingLines({
    date,
    includeProps: true,
    includeTeamPicks: false,
    onlyUncaptured: true,
    sports: ["NFL"],
    eventFilter: (iso) => inCaptureWindow(iso, now),
  });
  if (!r.ok) {
    console.error(`[${stamp}] failed: ${r.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[${stamp}] captured ${r.propPicksUpdated} pick(s). Credits remaining: ${r.creditsRemaining ?? "unknown"}`,
  );
}

main()
  .catch((e) => {
    console.error(`[${new Date().toISOString()}]`, e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
