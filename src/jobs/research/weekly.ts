/**
 * The weekly research run, after Monday night's game:
 *
 *   npm run research:weekly          (needs network for nflverse; no Odds API credits)
 *
 * Runs, in order, research:skill (grades every finished prop from nflverse,
 * then rebuilds the baseline backfill), research:sigma-validate and
 * research:latency, saving each one's full output under logs/weekly/<date>/.
 * Then prints one summary: grading, skill vs market (primary and live), the
 * Over-vs-books metric per venue, the σ gate, RB-out latency, and this NFL
 * week's credits by fetch type from the ledger. The summary's numbers come from
 * the same functions and seeds as the jobs and the analytics page.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/client";
import { backupConfiguredDatabase } from "@/lib/db/backup";
import { creditsByKind } from "@/lib/creditLedger";
import { parseSummaries } from "@/lib/jobSummary";
import { liveModelVersions, loadSkillItems, overGapRows, skillSection, type SkillSection } from "@/lib/predictionReport";
import { BASELINE_V0 } from "@/lib/predictionLog";
import { clusterBootstrap, OVER_CONFIRM_WEEKS, skillScore } from "@/lib/analysis/marketSkill";
import { PRICE_MOVE_PTS, type GroupLatency, type VenueChange } from "@/lib/analysis/newsLatency";
import { NEWS_TRIAL } from "@/lib/nfl/newsFetchTrial";
import { todayNflSlate } from "@/lib/nfl/slate";
import { fmtInterval, nflWeekStart, overStatusLine, sigmaVerdict, unaccountedCredits, type SigmaSample } from "@/lib/weeklySummary";
import type { PriceTest } from "@/lib/analysis/consensusSpread";

const JOBS = [
  { name: "skill", script: "src/jobs/research/scoreVsMarket.ts", label: "grading + research:skill" },
  { name: "sigma", script: "src/jobs/research/validateConsensusSigma.ts", label: "research:sigma-validate" },
  { name: "latency", script: "src/jobs/research/measureNewsLatency.ts", label: "research:latency" },
] as const;

function runJob(script: string, logFile: string): Promise<{ code: number; output: string; seconds: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--conditions=react-server", "--env-file=.env", "--import", "tsx", script], { cwd: process.cwd() });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => {
      writeFileSync(logFile, output);
      resolve({ code: code ?? 1, output, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

const lines: string[] = [];
const out = (s = "") => lines.push(s);

function skillLine(label: string, s: SkillSection | { items: number; score: ReturnType<typeof skillScore>; interval: ReturnType<typeof clusterBootstrap> }) {
  const score = "report" in s ? s.report?.overall : s.score;
  const iv = "report" in s ? s.report?.interval ?? null : s.interval;
  if (!score) return out(`  ${label.padEnd(52)} no scored props`);
  out(`  ${label.padEnd(52)} n=${String(score.n).padStart(4)} games=${String(score.games).padStart(3)}  skill ${fmtInterval(score.skill * 100, iv && { lo: iv.lo * 100, hi: iv.hi * 100 }, 2, "%")}`);
}

function latencyLine(g: GroupLatency, indent: string) {
  const m = (x: number | null) => (x == null ? "—" : `${Math.round(x)} min`);
  out(`${indent}${g.group.padEnd(12)} ${g.moved}/${g.props} moved, median ${m(g.medianMinutes)}${g.censoredAtLeast != null ? `; unmoved at ≥ ${m(g.censoredAtLeast)}` : ""}`);
}

async function main() {
  const now = new Date();
  const weekStart = nflWeekStart(now);
  const dir = path.join("logs", "weekly", todayNflSlate(now));
  mkdirSync(dir, { recursive: true });

  // Back up first: the run rewrites the backfill and fills results. No backup, no run.
  let backupLine: string;
  try {
    const b = backupConfiguredDatabase();
    const copy = !b.offsite ? "" : "copied" in b.offsite ? "; copied off-machine" : "refused" in b.offsite ? `; NOT copied off-machine (${b.offsite.refused})` : `; off-machine copy FAILED (${b.offsite.failed})`;
    backupLine = `Backup: ${path.relative(process.cwd(), b.backup.path)} (integrity ok${copy})`;
    console.log(backupLine);
  } catch (e) {
    console.error(`research:weekly stopped — the database backup failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  const results = new Map<string, { code: number; summaries: Map<string, unknown> }>();
  for (const job of JOBS) {
    process.stdout.write(`running ${job.label}… `);
    const r = await runJob(job.script, path.join(dir, `${job.name}.log`));
    console.log(r.code === 0 ? `done (${r.seconds}s)` : `FAILED with exit code ${r.code} (${r.seconds}s) — see ${dir}/${job.name}.log`);
    results.set(job.name, { code: r.code, summaries: parseSummaries(r.output) });
  }
  const failed = (name: string) => results.get(name)!.code !== 0;

  out(`\nPropEdge weekly research — ${now.toISOString().slice(0, 16)}Z; NFL week from ${weekStart.toISOString().slice(0, 16)}Z (Wednesday 00:00 ET)`);
  out(`Full output: ${dir}/`);
  out(backupLine);

  out("\nGRADING (nflverse weekly stats and snap counts)");
  const g = results.get("skill")!.summaries.get("grading") as Record<string, number> | undefined;
  if (failed("skill") || !g) out("  research:skill failed — nothing below is fresh; see skill.log");
  else {
    out(`  results filled ${g.filled} · disagreements with stored results ${g.mismatches} · voided ${g.voided} · unmatched ${g.unmatched} (names in skill.log)`);
    const latest = await prisma.playerProp.findFirst({ where: { sport: "NFL", isDemo: false, actualResult: { not: null } }, orderBy: { date: "desc" }, select: { date: true } });
    out(`  latest graded slate ${latest?.date ?? "—"}; props whose game nflverse has not posted yet: ${g.pending}`);
    if (g.pending > 0) out("  (nflverse posts a night's stats the next morning — if Monday night's game is among them, rerun then)");
  }

  out("\nSKILL VS MARKET (log-loss; + = model beats the de-vigged consensus; 95% game-bootstrap)");
  out("  [exploratory, not corrected] marks secondary intervals: several are looked at every week with no multiple-comparison correction, so one excluding zero is a lead, not a finding.");
  const primary = await skillSection("primary", "", { source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0 });
  skillLine("PRIMARY baseline-v0, consensus-v2 market", primary);
  const primaryItems = await loadSkillItems({ source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0 });
  const unknownQuoteTime = primaryItems.filter((i) => i.quoteTimeUnknown).length;
  if (unknownQuoteTime) {
    out(`    quote time unknown for ${unknownQuoteTime} of ${primaryItems.length} (snapshots stored before 2026-10-20 carry no fetch time; no-lookahead can't be checked for them — live rows are the clean measure)`);
  }
  const weekItems = primaryItems.filter((i) => (i.date ?? "") >= weekStart.toISOString().slice(0, 10));
  skillLine("  of which this week's slates [exploratory, not corrected]", { items: weekItems.length, score: skillScore(weekItems), interval: clusterBootstrap(weekItems, (x) => skillScore(x)?.skill ?? null) });
  const versions = await liveModelVersions();
  for (const v of versions) skillLine(`LIVE model ${v}`, await skillSection(v, "", { source: "live", marketMethod: "consensus-v2", modelVersion: v }));
  if (versions.length === 0) out("  LIVE: none yet — logged at scoring time since 2026-10-20; the first section appears once a slate generated since then is graded");

  out("\nOVER VS BOOKS (Over hit rate − books' P(over) at the venue's line, pts)");
  for (const r of await overGapRows(versions, { withStatus: true })) {
    if (!r.gap) out(`  ${r.label.padEnd(52)} no graded lines`);
    else out(`  ${r.label.padEnd(52)} n=${String(r.gap.n).padStart(4)} games=${String(r.gap.games).padStart(3)}  ${fmtInterval(r.gap.gapPts, r.gap.interval, 1, " pts")}`);
    if (r.status) out(`    status: ${overStatusLine(r.status)}`);
  }
  out(`  (flag on the first week the cumulative interval excludes zero; confirmed only if the weeks after it alone, ≥ ${OVER_CONFIRM_WEEKS}, still exclude zero on the same side)`);

  out("\nσ GATE (fitted spread vs current at venue lines; log-loss fitted − current, − favours fitted)");
  const sigma = results.get("sigma")!.summaries.get("sigma") as { types: string[]; samples: SigmaSample[] } | undefined;
  if (failed("sigma") || !sigma) out("  research:sigma-validate failed — see sigma.log");
  else {
    out(`  prop types: ${sigma.types.join(", ")}`);
    for (const s of sigma.samples) {
      if (s.n === 0 || s.diff == null) {
        out(`  ${s.sample.padEnd(10)} no graded venue lines`);
        continue;
      }
      out(
        `  ${s.sample.padEnd(10)} n=${String(s.n).padStart(4)} games=${String(s.games).padStart(3)}  ${fmtInterval(s.diff, s.interval, 4)}` +
          `  ECE ${s.eceFitted?.toFixed(2)} vs ${s.eceCurrent?.toFixed(2)} pts${s.gate ? `  gate ${s.gate}` : ""}` +
          (s.sample === "pooled" ? "" : "  [exploratory, not corrected]"),
      );
    }
    const v = sigmaVerdict(sigma.samples);
    out(`  verdict: ${v.verdict} — ${v.reason}`);
    const price = results.get("sigma")!.summaries.get("sigmaPrice") as (PriceTest & { fitDay: string }) | undefined;
    if (price) {
      out(
        price.ladders === 0
          ? `  held-out price test: no ladders after ${price.fitDay} yet (the next slate fetch buys them)`
          : price.verdict === "pending"
            ? `  held-out price test (ladders after ${price.fitDay}): ${price.ladders} ladders from ${price.games} game — pending; the by-game interval needs at least 2`
            : `  held-out price test (ladders after ${price.fitDay}): ${price.ladders} ladders, ${price.games} games, RMSE current ${price.rmseCurrent!.toFixed(2)} → fitted ${price.rmseFitted!.toFixed(2)} pts; ` +
              `difference ${fmtInterval(price.diff!, price.interval, 2, " pts²")} — ${price.verdict === "keep" ? "keep" : "REVERT: σ doesn't beat the old spread on held-out ladders"}`,
      );
    }
    out("  (the revert rule reads the pooled sample only; the others are for information)");
  }

  out("\nRB-OUT NEWS TRIAL (each venue's change between the +10 and +40 minute fetches: teammates vs the other team)");
  out(`  news time = our poll's first sighting (~15-min resolution), not the report's own time; a move = a line change or ≥ ${PRICE_MOVE_PTS} pts on a book's no-vig Over`);
  const lat = results.get("latency")!.summaries.get("latency") as
    | {
        changes: number;
        trial: { done: number; skipped: number; credits: number };
        windows: { window: string; events: number; treated: VenueChange[]; control: VenueChange[]; pre: GroupLatency[] }[];
      }
    | undefined;
  if (failed("latency") || !lat) out("  research:latency failed — see latency.log");
  else {
    out(`  changes to Out: ${lat.changes}; trial fetches ${lat.trial.done} done, ${lat.trial.skipped} skipped, ${lat.trial.credits} of ${NEWS_TRIAL.budgetCredits} credits`);
    const names: Record<string, string> = { friday: "Friday's final report", inactives: "Game-day inactives", other: "Other times" };
    for (const w of ["friday", "inactives", "other"]) {
      const b = lat.windows.find((x) => x.window === w);
      if (!b) continue;
      out(`  ${names[w]} — ${b.events} event(s)`);
      const groups = [...new Set([...b.treated, ...b.control].map((g) => g.group))].sort();
      const fmtChange = (g: VenueChange | undefined) =>
        g ? `${g.moved}/${g.props} moved, mean line ${g.meanLineChange == null ? "—" : `${g.meanLineChange >= 0 ? "+" : ""}${g.meanLineChange.toFixed(2)}`}` : "—";
      for (const group of groups) {
        out(`    ${group.padEnd(12)} teammates ${fmtChange(b.treated.find((g) => g.group === group)).padEnd(32)} other team ${fmtChange(b.control.find((g) => g.group === group))}`);
      }
      if (b.pre.length) {
        out("    secondary — from the last stored quote before the news [exploratory, not corrected]:");
        b.pre.forEach((x) => latencyLine(x, "      "));
      }
      if (!groups.length && !b.pre.length) out("    nothing measurable yet");
    }
    if (lat.windows.length === 0) out("  nothing measurable yet");
  }

  out("\nCREDITS THIS WEEK (Odds API, from the credit ledger)");
  const byKind = await creditsByKind(weekStart);
  const rows = await prisma.creditSpend.findMany({ where: { at: { gte: weekStart } }, orderBy: { at: "asc" }, select: { at: true, credits: true, remaining: true } });
  const first = await prisma.creditSpend.findFirst({ orderBy: { at: "asc" }, select: { at: true } });
  for (const k of byKind) {
    out(
      `  ${k.kind.padEnd(18)} ${String(k.credits).padStart(4)} credits in ${k.calls} call${k.calls === 1 ? "" : "s"}` +
        (k.unknownCost ? ` (+ ${k.unknownCost} timed out or failed — cost unknown, may have been charged)` : ""),
    );
  }
  const total = byKind.reduce((s, k) => s + k.credits, 0);
  out(`  ${"total".padEnd(18)} ${String(total).padStart(4)}${rows.length ? `; balance after the last call ${rows[rows.length - 1].remaining ?? "—"}` : ""}`);
  if (rows.length > 1) out(`  spent between logged calls by something unlogged: ${unaccountedCredits(rows)}`);
  if (!first || first.at > weekStart) out(`  the ledger began ${first ? first.at.toISOString().slice(0, 16) + "Z" : "with no calls yet"}; spends earlier this week are not itemised`);

  const text = lines.join("\n");
  console.log(text);
  writeFileSync(path.join(dir, "summary.txt"), text + "\n");
  await prisma.$disconnect();
  if ([...results.values()].some((r) => r.code !== 0)) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
