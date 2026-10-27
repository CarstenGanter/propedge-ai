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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/client";
import { backupConfiguredDatabase } from "@/lib/db/backup";
import { creditsByKind } from "@/lib/creditLedger";
import { parseSummaries } from "@/lib/jobSummary";
import { liveModelVersions, loadEntriesPlayed, loadGreenPicks, loadSkillItems, overGapRows, overGapSamples, skillSection, type LoadedGreenPick, type SkillSection } from "@/lib/predictionReport";
import { BASELINE_V0 } from "@/lib/predictionLog";
import { clusterBootstrap, OVER_CONFIRM_WEEKS, overGap, skillScore, type OverGap, type SkillItem } from "@/lib/analysis/marketSkill";
import { PRICE_MOVE_PTS, type GroupLatency, type VenueChange } from "@/lib/analysis/newsLatency";
import { NEWS_TRIAL } from "@/lib/nfl/newsFetchTrial";
import { todayNflSlate } from "@/lib/nfl/slate";
import { breakEvenRows, changeCell, fmtInterval, greenSummary, nflWeekStart, overStatusLine, sigmaVerdict, SMALL_CELL_N, unaccountedCredits, type SigmaSample } from "@/lib/weeklySummary";
import { VALUE_MARGIN } from "@/lib/analysis/pickemMath";
import { previousWeek, topLine, trendTable, upsertWeek, type WeekRecord } from "@/lib/weeklyTrends";
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
  // The TOP LINE goes here once every section below has been computed.
  const topAt = lines.length;
  const rec: WeekRecord = {
    week: weekStart.toISOString().slice(0, 10),
    runAt: now.toISOString(),
    primarySkillPct: null,
    liveVersion: null,
    liveSkillPct: null,
    overGapPts: {},
    overFlags: {},
    sigmaPooled: null,
    heldOutEce: { fitted: null, current: null },
    sigmaVerdict: null,
    priceVerdict: null,
    credits: 0,
    greenClv: { picks: 0, withClose: 0, meanPts: null },
    unmatched: null,
    pending: null,
    failedJobs: JOBS.filter((j) => failed(j.name)).map((j) => j.name),
  };

  out("\nGRADING (nflverse weekly stats and snap counts)");
  const g = results.get("skill")!.summaries.get("grading") as Record<string, number> | undefined;
  if (failed("skill") || !g) out("  research:skill failed — nothing below is fresh; see skill.log");
  else {
    out(
      `  results filled ${g.filled} · disagreements with stored results ${g.mismatches} · voided ${g.voided} · unmatched ${g.unmatched} (names in skill.log)` +
        ` · matched by an approved alias ${g.byAlias ?? 0} (src/lib/nfl/playerAliases.ts)`,
    );
    rec.unmatched = g.unmatched;
    rec.pending = g.pending;
    const latest = await prisma.playerProp.findFirst({ where: { sport: "NFL", isDemo: false, actualResult: { not: null } }, orderBy: { date: "desc" }, select: { date: true } });
    out(`  latest graded slate ${latest?.date ?? "—"}; props whose game nflverse has not posted yet: ${g.pending}`);
    if (g.pending > 0) out("  (nflverse posts a night's stats the next morning — if Monday night's game is among them, rerun then)");
  }

  out(`\nPICKS (graded NFL picks the board showed green: books' P(our side) × Underdog payout ≥ ${VALUE_MARGIN.toFixed(2)}, standard payout when none entered, price not thin)`);
  const versions = await liveModelVersions();
  const green = await loadGreenPicks();
  const greenAll = greenSummary(green);
  rec.greenClv = { picks: greenAll.n, withClose: greenAll.clv.n, meanPts: greenAll.clv.meanPts };
  const pickLine = (label: string, xs: LoadedGreenPick[]) => {
    const s = greenSummary(xs);
    if (s.n === 0) return out(`  ${label.padEnd(36)} no green picks graded`);
    out(`  ${label.padEnd(36)} n=${String(s.n).padStart(3)}  hits ${s.hits} (${(s.hitRate! * 100).toFixed(1)}%)  books' mean P(our side) at pick time ${(s.meanBooks! * 100).toFixed(1)}%`);
    if (s.clv.n === 0) out(`    CLV: no pick has a quote stored before kickoff (${s.clv.missing} left out)`);
    else {
      const fromStore = xs.filter((x) => x.closeSource === "store").length;
      out(
        `    CLV ${fmtInterval(s.clv.meanPts!, s.clv.interval, 2, " pts")}  beat the close ${s.clv.beatPct!.toFixed(0)}% of ${s.clv.n}` +
          `  (close: odds store ${fromStore}, closing capture on the pick ${s.clv.n - fromStore}; no close stored ${s.clv.missing}, left out)`,
      );
    }
  };
  for (const [label, xs] of [
    ["all graded (every model version)", green],
    ...(versions[0] ? [[`live model ${versions[0]} only`, green.filter((x) => x.modelVersion === versions[0])] as const] : []),
  ] as const) {
    pickLine(label, xs);
    const entered = xs.filter((x) => x.payoutEntered);
    const assumed = xs.filter((x) => !x.payoutEntered);
    if (entered.length && assumed.length) {
      pickLine("  of which Underdog payout entered", entered);
      pickLine("  of which standard payout assumed", assumed);
    } else if (xs.length) out(`    all ${xs.length} on ${entered.length ? "an entered Underdog payout" : "the standard payout assumed — none had Underdog's payout entered"}`);
  }
  out("  (standard assumed = no payout entered, so green only at the 1.87x the board assumes; Underdog pays less on many such picks)");
  out("  CLV = books' P(our side) at the line played, last stored quote before kickoff − at pick time; 95% game-bootstrap");
  out("  break-even per leg, real-money entries played (at the median multiplier paid):");
  for (const r of breakEvenRows(await loadEntriesPlayed())) {
    out(`    ${r.label.padEnd(8)} ${String(r.entries).padStart(2)} entr${r.entries === 1 ? "y" : "ies"}  ${r.medianMultiplier.toFixed(2)}x → ${(r.breakEvenPerLeg * 100).toFixed(1)}% a leg`);
  }

  out("\nSKILL VS MARKET (log-loss; + = model beats the de-vigged consensus; 95% game-bootstrap)");
  out("  [exploratory, not corrected] marks secondary intervals: several are looked at every week with no multiple-comparison correction, so one excluding zero is a lead, not a finding.");
  const backfillItems = await loadSkillItems({ source: "backfill", marketMethod: "consensus-v2", modelVersion: BASELINE_V0 });
  const scored = (xs: typeof backfillItems) => ({ items: xs.length, score: skillScore(xs), interval: clusterBootstrap(xs, (x) => skillScore(x)?.skill ?? null) });
  // Primary: rows whose quote time is recorded, so no-lookahead is checked for every one.
  const primaryItems = backfillItems.filter((i) => !i.quoteTimeUnknown);
  const unknownQuoteTime = backfillItems.length - primaryItems.length;
  const primaryScored = scored(primaryItems);
  rec.primarySkillPct = primaryScored.score ? primaryScored.score.skill * 100 : null;
  skillLine("PRIMARY baseline-v0, consensus-v2, known quote time", primaryScored);
  const weekItems = primaryItems.filter((i) => (i.date ?? "") >= weekStart.toISOString().slice(0, 10));
  skillLine("  of which this week's slates [exploratory, not corrected]", scored(weekItems));
  skillLine(`secondary: all rows, includes ${unknownQuoteTime} rows with unknown quote time [exploratory, not corrected]`, scored(backfillItems));
  out("    (snapshots stored before 2026-10-20 carry no fetch time, so no-lookahead can't be checked for those rows)");
  for (const v of versions) {
    const live = await skillSection(v, "", { source: "live", marketMethod: "consensus-v2", modelVersion: v });
    if (v === versions[0]) {
      rec.liveVersion = v;
      rec.liveSkillPct = live.report?.overall ? live.report.overall.skill * 100 : null;
    }
    skillLine(`LIVE model ${v}`, live);
  }
  if (versions.length === 0) out("  LIVE: none yet — logged at scoring time since 2026-10-20; the first section appears once a slate generated since then is graded");

  out("\nOVER VS BOOKS (Over hit rate − books' P(over) at the venue's line, pts)");
  const gapLine = (label: string, gap: OverGap | null, suffix = "") =>
    out(
      !gap
        ? `  ${label.padEnd(52)} no graded lines`
        : `  ${label.padEnd(52)} n=${String(gap.n).padStart(4)} games=${String(gap.games).padStart(3)}  ${fmtInterval(gap.gapPts, gap.interval, 1, " pts")}${suffix}`,
    );
  const gapRows = await overGapRows(versions, { withStatus: true });
  const samples = overGapSamples(versions);
  const sampleItems: SkillItem[][] = [];
  const shortName = (i: number) => (i === 0 ? "Underdog hist" : i === 1 ? "PrizePicks hist" : `Underdog live ${versions[i - 2]}`);
  for (const [i, r] of gapRows.entries()) {
    rec.overGapPts[shortName(i)] = r.gap?.gapPts ?? null;
    if (r.status) rec.overFlags[shortName(i)] = { state: r.status.state, direction: r.status.direction };
    gapLine(r.label, r.gap);
    if (r.status) out(`    status: ${overStatusLine(r.status)}`);
    // Stress test: only lines a sportsbook posted exactly, priced from those books alone.
    gapLine("  exact line only (no spread-curve reading)", overGap(await loadSkillItems({ ...samples[i][1], exactLine: true })));
    sampleItems.push(await loadSkillItems(samples[i][1]));
  }
  out(`  (flag on the first week the cumulative interval excludes zero; confirmed only if the weeks after it alone, ≥ ${OVER_CONFIRM_WEEKS}, still exclude zero on the same side; the rule reads the full rows above, not the exact-line ones)`);
  out("  by prop type [exploratory, not corrected]:");
  for (const [i, [label]] of samples.entries()) {
    out(`    ${label}`);
    const byType = new Map<string, SkillItem[]>();
    for (const it of sampleItems[i]) byType.set(it.propType, [...(byType.get(it.propType) ?? []), it]);
    for (const [type, xs] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) gapLine(`    ${type}`, overGap(xs));
  }

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
    rec.sigmaVerdict = v.verdict;
    rec.sigmaPooled = sigma.samples.find((s) => s.sample === "pooled")?.diff ?? null;
    const held = sigma.samples.find((s) => s.sample === "held-out");
    rec.heldOutEce = { fitted: held?.eceFitted ?? null, current: held?.eceCurrent ?? null };
    const price = results.get("sigma")!.summaries.get("sigmaPrice") as (PriceTest & { fitDay: string }) | undefined;
    if (price) {
      rec.priceVerdict = price.ladders === 0 ? "no ladders" : price.verdict;
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

  out("\nRB-OUT NEWS TRIAL (each book's change from the last stored quote before the news to the +40 minute fetch: the out RB's teammates by position vs the other team)");
  out(`  news time = our poll's first sighting (~15-min resolution), not the report's own time; a move = a line change or ≥ ${PRICE_MOVE_PTS} pts on a book's no-vig Over`);
  out("  median move times are bounded by our fetch schedule (news sighting at ~15-min resolution, fetches at +10/+40), so they are not book reaction times");
  const lat = results.get("latency")!.summaries.get("latency") as
    | {
        changes: number;
        trial: { done: number; skipped: number; credits: number };
        windows: {
          window: string;
          events: number;
          withPlus40?: number;
          withPreQuote?: number;
          primary?: { group: string; changes: VenueChange[] }[];
          primaryControl?: VenueChange[];
          treated: VenueChange[];
          control: VenueChange[];
          pre: GroupLatency[];
        }[];
      }
    | undefined;
  if (failed("latency") || !lat) out("  research:latency failed — see latency.log");
  else {
    out(`  changes to Out: ${lat.changes}; trial fetches ${lat.trial.done} done, ${lat.trial.skipped} skipped, ${lat.trial.credits} of ${NEWS_TRIAL.budgetCredits} credits`);
    out(`  cells: moved/props, then the mean line change; ⚠ = fewer than ${SMALL_CELL_N} props, too few to read`);
    out(`  the trial buys ${NEWS_TRIAL.propTypes.join(", ")} only, so WR/TE teammates appear only where a book posts one of those for them;`);
    out("  Friday news usually lands before any stored quote of Sunday's game (the slate is fetched on game day), so few Friday events reach the primary comparison");
    const names: Record<string, string> = { friday: "Friday's final report", inactives: "Game-day inactives", other: "Other times" };
    const order = ["backup RB", "pass-catchers (WR/TE)", "QB", "other"];
    for (const w of ["friday", "inactives", "other"]) {
      const b = lat.windows.find((x) => x.window === w);
      if (!b) continue;
      out(`  ${names[w]} — ${b.events} event(s), ${b.withPlus40 ?? 0} with the trial's +40 fetch, ${b.withPreQuote ?? 0} of those with a teammate quote stored before the news`);
      const primary = (b.primary ?? []).sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group));
      if (primary.length) {
        out("    PRIMARY — last stored quote before the news → +40 fetch");
        const cols = [...primary.map((p) => p.group), "other team"];
        out(`      ${"book".padEnd(12)} ${cols.map((c) => c.padEnd(22)).join(" ")}`);
        const books = [...new Set([...primary.flatMap((p) => p.changes), ...(b.primaryControl ?? [])].map((g) => g.group))].sort();
        for (const book of books) {
          const cells = [...primary.map((p) => p.changes.find((g) => g.group === book)), (b.primaryControl ?? []).find((g) => g.group === book)];
          out(`      ${book.padEnd(12)} ${cells.map((c) => changeCell(c).padEnd(22)).join(" ")}`);
        }
      }
      const groups = [...new Set([...b.treated, ...b.control].map((g) => g.group))].sort();
      if (groups.length) {
        out("    secondary — +10 → +40 fetches, all teammates vs the other team [exploratory, not corrected]:");
        for (const group of groups) {
          out(`      ${group.padEnd(12)} teammates ${changeCell(b.treated.find((g) => g.group === group)).padEnd(22)} other team ${changeCell(b.control.find((g) => g.group === group))}`);
        }
      }
      if (b.pre.length) {
        out("    secondary — time to the first move after the last stored quote [exploratory, not corrected]:");
        b.pre.forEach((x) => latencyLine(x, "      "));
      }
      if (!primary.length && !groups.length && !b.pre.length) out("    nothing measurable yet");
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
  rec.credits = total;
  out(`  ${"total".padEnd(18)} ${String(total).padStart(4)}${rows.length ? `; balance after the last call ${rows[rows.length - 1].remaining ?? "—"}` : ""}`);
  if (rows.length > 1) out(`  spent between logged calls by something unlogged: ${unaccountedCredits(rows)}`);
  if (!first || first.at > weekStart) out(`  the ledger began ${first ? first.at.toISOString().slice(0, 16) + "Z" : "with no calls yet"}; spends earlier this week are not itemised`);

  // History: this week's headline numbers, replacing an earlier run of the same week.
  const historyFile = path.join("logs", "weekly", "history.json");
  let history: WeekRecord[] = [];
  try {
    if (existsSync(historyFile)) history = JSON.parse(readFileSync(historyFile, "utf8")) as WeekRecord[];
  } catch (e) {
    console.error(`${historyFile} unreadable, starting a new one: ${e instanceof Error ? e.message : String(e)}`);
  }
  const prev = previousWeek(history, rec.week);
  history = upsertWeek(history, rec);
  writeFileSync(historyFile, JSON.stringify(history, null, 2) + "\n");
  out("\nTRENDS (last 6 NFL weeks, from logs/weekly/history.json; a rerun replaces its week)");
  trendTable(history).forEach((l) => out(l));

  lines.splice(topAt, 0, "\nTOP LINE", ...topLine(rec, prev).map((l) => `  ${l}`));

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
