import { runAutoCapture } from "@/lib/nfl/runAutoCapture";
import { runAutoSettle } from "@/lib/runAutoSettle";
import { runInjuryWatch } from "@/lib/nfl/injuryWatch";
import { runNewsFetches } from "@/lib/nfl/newsFetch";

/**
 * In-app closing-line capture and settlement: every 15 minutes while the
 * server is running.
 * A 40-minute capture window cannot fall between two runs, whatever minute the
 * server happened to start on. Each run exits after a local database count
 * unless a game is actually due, so leaving the app open costs nothing.
 *
 * Unlike the launchd job this is not limited to Sun/Mon/Thu — it is free to
 * run, so it also covers late-season Saturday and holiday games.
 */
const INTERVAL_MS = 15 * 60_000;
const FIRST_RUN_MS = 30_000;

// The news-fetch trial's fetches are due ~10 and ~40 minutes after a change is
// seen; checking every 5 minutes keeps them close to that while the app runs.
const NEWS_FETCH_INTERVAL_MS = 5 * 60_000;

// Dev-mode reloads can re-run this module; keep exactly one timer.
const g = globalThis as {
  __propedgeAutoCapture?: ReturnType<typeof setInterval>;
  __propedgeNewsFetch?: ReturnType<typeof setInterval>;
};

async function tick() {
  // Quiet unless something happened — a skip every 15 minutes is noise.
  for (const [name, run] of [["capture", runAutoCapture], ["settle", runAutoSettle], ["injury-watch", runInjuryWatch], ["news-fetch", runNewsFetches]] as const) {
    try {
      const line = await run("app");
      if (!line.includes(": skip") && !line.includes("skip —")) console.log(line);
    } catch (e) {
      console.error(`[auto-${name}] failed:`, e);
    }
  }
}

if (!g.__propedgeNewsFetch) {
  g.__propedgeNewsFetch = setInterval(async () => {
    try {
      const line = await runNewsFetches("app");
      if (!line.includes("skip —")) console.log(line);
    } catch (e) {
      console.error("[news-fetch] failed:", e);
    }
  }, NEWS_FETCH_INTERVAL_MS);
}

if (!g.__propedgeAutoCapture) {
  setTimeout(tick, FIRST_RUN_MS);
  g.__propedgeAutoCapture = setInterval(tick, INTERVAL_MS);
  console.log("[auto-capture] scheduled every 15 min while the app is running");
}
