/**
 * research:weekly's memory across weeks (pure): one record of headline numbers
 * per NFL week, kept in logs/weekly/history.json, read back for the TRENDS
 * table and for the TOP LINE's "what changed since last week".
 */

export type FlagState = "none" | "flagged" | "confirmed";

export interface WeekRecord {
  /** The NFL week's Wednesday (YYYY-MM-DD); a rerun in the same week replaces its record. */
  week: string;
  runAt: string;
  /** Skill vs market, %, known-quote-time backfill rows. */
  primarySkillPct: number | null;
  liveVersion: string | null;
  liveSkillPct: number | null;
  /** Over hit rate − books' P(over), pts, per Over-vs-books sample, keyed by short name. */
  overGapPts: Record<string, number | null>;
  overFlags: Record<string, { state: FlagState; direction: "below" | "above" | null }>;
  /** σ: pooled log-loss difference, fitted − current. */
  sigmaPooled: number | null;
  heldOutEce: { fitted: number | null; current: number | null };
  sigmaVerdict: string | null;
  priceVerdict: string | null;
  credits: number;
  greenClv: { picks: number; withClose: number; meanPts: number | null };
  unmatched: number | null;
  pending: number | null;
  failedJobs: string[];
}

/** Add or replace this week's record; oldest first. */
export function upsertWeek(history: WeekRecord[], rec: WeekRecord): WeekRecord[] {
  return [...history.filter((h) => h.week !== rec.week), rec].sort((a, b) => a.week.localeCompare(b.week));
}

/** The latest record from a week before `week`. */
export function previousWeek(history: WeekRecord[], week: string): WeekRecord | null {
  return history.filter((h) => h.week < week).sort((a, b) => a.week.localeCompare(b.week)).at(-1) ?? null;
}

const signed = (x: number | null | undefined, digits: number, unit = "") =>
  x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}${unit}`;

/** The last `n` weeks side by side, one metric per row. */
export function trendTable(history: WeekRecord[], n = 6): string[] {
  const weeks = [...history].sort((a, b) => a.week.localeCompare(b.week)).slice(-n);
  if (weeks.length === 0) return ["  no weeks recorded yet"];
  const keys = [...new Set(weeks.flatMap((w) => Object.keys(w.overGapPts)))];
  const rows: [string, (w: WeekRecord) => string][] = [
    ["primary skill", (w) => signed(w.primarySkillPct, 2, "%")],
    ["live skill", (w) => (w.liveVersion ? `${signed(w.liveSkillPct, 2, "%")} ${w.liveVersion}` : "—")],
    ...keys.map((k): [string, (w: WeekRecord) => string] => [`Over gap ${k}`, (w) => signed(w.overGapPts[k], 1, " pts")]),
    ["σ pooled log-loss", (w) => signed(w.sigmaPooled, 4)],
    ["held-out ECE fit/cur", (w) => (w.heldOutEce.fitted == null ? "—" : `${w.heldOutEce.fitted.toFixed(2)}/${w.heldOutEce.current?.toFixed(2) ?? "—"}`)],
    ["credits spent", (w) => String(w.credits)],
  ];
  const col = 16;
  const labelW = Math.max(...rows.map(([label]) => label.length)) + 2;
  return [
    `  ${"week of".padEnd(labelW)}${weeks.map((w) => w.week.padEnd(col)).join("")}`,
    ...rows.map(([label, f]) => `  ${label.padEnd(labelW)}${weeks.map((w) => f(w).padEnd(col)).join("")}`),
  ];
}

const flagText = (f: { state: FlagState; direction: "below" | "above" | null }) =>
  `${f.state.toUpperCase()}${f.direction ? ` (Over ${f.direction} the books)` : ""}`;

/**
 * At most four lines: flags new, cleared or confirmed since last week; keep/
 * revert verdict changes; the green-pick CLV headline; what needs action.
 */
export function topLine(cur: WeekRecord, prev: WeekRecord | null): string[] {
  const keys = Object.keys(cur.overFlags);
  let flags: string;
  if (!prev) {
    const up = keys.filter((k) => cur.overFlags[k].state !== "none").map((k) => `${k} ${flagText(cur.overFlags[k])}`);
    flags = `Flags (first week on record): ${up.length ? up.join("; ") : "none raised"}`;
  } else {
    const changes: string[] = [];
    for (const k of keys) {
      const was = prev.overFlags[k]?.state ?? "none";
      const now = cur.overFlags[k].state;
      if (was === now) continue;
      if (was === "none") changes.push(`NEW ${k} ${flagText(cur.overFlags[k])}`);
      else if (now === "none") changes.push(`CLEARED ${k}`);
      else if (now === "confirmed") changes.push(`CONFIRMED ${k} ${flagText(cur.overFlags[k])}`);
      else changes.push(`${k} ${was} → ${now}`);
    }
    const standing = keys.filter((k) => cur.overFlags[k].state !== "none").map((k) => `${k} ${flagText(cur.overFlags[k])}`);
    flags = changes.length ? `Flags: ${changes.join("; ")}` : `Flags: no change since ${prev.week}${standing.length ? ` (${standing.join("; ")})` : " (none raised)"}`;
  }

  const verdicts = `σ ${cur.sigmaVerdict ?? "—"}, held-out price test ${cur.priceVerdict ?? "—"}`;
  const changed = prev && (prev.sigmaVerdict !== cur.sigmaVerdict || prev.priceVerdict !== cur.priceVerdict);
  const verdictLine = `Verdicts: ${verdicts}${!prev ? "" : changed ? ` — CHANGED from σ ${prev.sigmaVerdict ?? "—"}, price test ${prev.priceVerdict ?? "—"}` : " (unchanged)"}`;

  const g = cur.greenClv;
  const clv =
    g.picks === 0
      ? "Green-pick CLV: no green picks graded"
      : g.withClose === 0
        ? `Green-pick CLV: none of ${g.picks} green picks has a stored close`
        : `Green-pick CLV: ${signed(g.meanPts, 2, " pts")} on ${g.withClose} of ${g.picks} green picks (the rest have no stored close)`;

  const actions: string[] = [];
  if (cur.failedJobs.length) actions.push(`rerun — failed: ${cur.failedJobs.join(", ")}`);
  if (cur.pending) actions.push(`${cur.pending} props not graded yet — rerun after nflverse posts`);
  if (cur.unmatched) actions.push(`${cur.unmatched} unmatched props — check skill.log for names to alias`);
  if (cur.sigmaVerdict === "REVERT" || cur.priceVerdict === "REVERT") actions.push("a σ verdict says REVERT — review the numbers before reverting");
  for (const k of keys) {
    if (cur.overFlags[k].state === "confirmed" && prev?.overFlags[k]?.state !== "confirmed") actions.push(`${k} Over flag confirmed — decide what it changes`);
  }
  return [flags, verdictLine, clv, `Action: ${actions.length ? actions.join("; ") : "none"}`];
}
