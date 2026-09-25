/**
 * Scheduled closing-line capture, run by launchd every 15 minutes on game days
 * (see scripts/install-auto-capture.sh) so it works even with the app closed.
 * The logic lives in runAutoCapture, shared with the in-app scheduler.
 *
 *   npm run capture:auto
 */
import { prisma } from "@/lib/db/client";
import { runAutoCapture } from "@/lib/nfl/runAutoCapture";

runAutoCapture("launchd")
  .then((line) => console.log(line))
  .catch((e) => {
    console.error(`[${new Date().toISOString()}] launchd`, e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
