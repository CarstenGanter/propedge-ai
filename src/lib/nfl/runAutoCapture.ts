import "server-only";
import { prisma } from "@/lib/db/client";
import { captureClosingLines } from "@/lib/captureLines";
import { cacheGet, cacheSet, releaseLock, tryAcquireLock } from "@/lib/providerCache";
import { teamsMatch } from "@/lib/utils/teamName";
import { toNflSlateDate } from "./slate";
import { decideCapture, type UncapturedGame } from "./autoCapture";

const LOCK_KEY = "lock:closing-capture";
const LOCK_TTL_MS = 10 * 60_000;
const attemptedKey = (date: string) => `capture:attempted:${date}`;

/** Games on the slate that still hold a pick with no closing line, from the picks themselves. */
async function uncapturedGames(date: string): Promise<UncapturedGame[]> {
  const picks = await prisma.pick.findMany({
    where: {
      date,
      status: "pending",
      isDemo: false,
      closingProb: null,
      playerProp: { sport: "NFL", source: "The Odds API" },
    },
    select: { playerProp: { select: { gameId: true, gameStartTime: true, team: true, opponent: true } } },
  });
  const byGame = new Map<string, UncapturedGame>();
  for (const { playerProp: p } of picks) {
    // A pick with no kickoff time cannot be placed in the window; skipping it
    // costs a closing line, while guessing could cost credits.
    if (!p.gameStartTime) continue;
    const gameId = p.gameId ?? `${p.team}|${p.opponent}`;
    const g = byGame.get(gameId);
    if (g) g.picks++;
    // Odds API props store the home side as `team`.
    else byGame.set(gameId, { gameId, kickoffISO: p.gameStartTime.toISOString(), home: p.team, away: p.opponent, picks: 1 });
  }
  return [...byGame.values()];
}

/**
 * One pass of the automatic closing-line capture, shared by the launchd job
 * (runs even with the app closed) and the in-app scheduler (runs while the dev
 * server is up). Everything before the capture is a local database read, so a
 * run with nothing due costs nothing.
 *
 * Credits are spent only on games that are 20-60 minutes from kickoff AND still
 * hold an uncaptured pick, each game at most once per slate. The decision is
 * re-made under a lock so the two schedulers can never both pay for a game.
 *
 * Returns a one-line summary for the caller to log.
 */
export async function runAutoCapture(source: "launchd" | "app", now = new Date()): Promise<string> {
  const stamp = now.toISOString();
  const date = toNflSlateDate(stamp);
  const log = (msg: string) => `[${stamp}] ${source} ${date}: ${msg}`;

  const attemptedNow = async () => new Set((await cacheGet<string[]>(attemptedKey(date)))?.value ?? []);

  const first = decideCapture(await uncapturedGames(date), await attemptedNow(), now);
  if (first.action === "skip") return log(`skip — ${first.reason}`);

  if (!(await tryAcquireLock(LOCK_KEY, source, LOCK_TTL_MS))) {
    return log("skip — another capture is already running");
  }
  try {
    // Re-decide under the lock: the other scheduler may have just finished.
    const attempted = await attemptedNow();
    const decision = decideCapture(await uncapturedGames(date), attempted, now);
    if (decision.action === "skip") return log(`skip — ${decision.reason}`);
    const due = decision.games;

    // Recorded before paying, so a crash or an unmatched prop can never lead to
    // the same game being bought again on the next run.
    await cacheSet(attemptedKey(date), [...attempted, ...due.map((g) => g.gameId)]);

    const r = await captureClosingLines({
      date,
      includeProps: true,
      includeTeamPicks: false,
      onlyUncaptured: true,
      sports: ["NFL"],
      eventFilter: (e) =>
        due.some(
          (g) =>
            (teamsMatch(e.home_team, g.home) && teamsMatch(e.away_team, g.away)) ||
            (teamsMatch(e.home_team, g.away) && teamsMatch(e.away_team, g.home)),
        ),
    });
    if (!r.ok) return log(`FAILED — ${r.error}`);
    const wanted = due.reduce((n, g) => n + g.picks, 0);
    return log(
      `captured ${r.propPicksUpdated} of ${wanted} pick(s) across ${due.length} game(s)` +
        (r.propPicksUpdated < wanted ? " (the rest had no matching book line — not retried)" : "") +
        `. Credits remaining: ${r.creditsRemaining ?? "unknown"}`,
    );
  } finally {
    await releaseLock(LOCK_KEY);
  }
}
