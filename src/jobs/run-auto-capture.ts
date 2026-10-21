/**
 * Scheduled closing-line capture, run by launchd every 15 minutes on game days
 * (see scripts/install-auto-capture.sh) so it works even with the app closed.
 * It also settles finished picks and logs injury-report status changes (both
 * free, ESPN). The logic lives in runAutoCapture, runAutoSettle and
 * runInjuryWatch, shared with the in-app scheduler.
 *
 *   npm run capture:auto
 */
import { prisma } from "@/lib/db/client";
import { runAutoCapture } from "@/lib/nfl/runAutoCapture";
import { runAutoSettle } from "@/lib/runAutoSettle";
import { runInjuryWatch } from "@/lib/nfl/injuryWatch";
import { runNewsFetches } from "@/lib/nfl/newsFetch";
import { runSteps } from "@/lib/schedulerSteps";

// Capture first: it is time-critical (20-60 min before kickoff); settling can wait.
// Each step runs on its own, so a failure in one never skips the others.
runSteps([
  ["capture", () => runAutoCapture("launchd")],
  ["settle", () => runAutoSettle("launchd")],
  ["injury-watch", () => runInjuryWatch("launchd")],
  ["news-fetch", () => runNewsFetches("launchd")],
])
  .then((results) => {
    for (const r of results) (r.ok ? console.log : console.error)(r.line);
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
