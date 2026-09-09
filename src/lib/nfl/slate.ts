/**
 * Pure NFL slate helpers. NFL "slate dates" are keyed to US Eastern time so
 * that Sunday Night Football (8:20pm ET) stays on Sunday no matter where this
 * machine runs — the same convention ESPN's scoreboard `?dates=` uses.
 */

export const NFL_TZ = "America/New_York";

const slateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: NFL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** UTC ISO timestamp → "YYYY-MM-DD" in US Eastern time. */
export function toNflSlateDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return slateFmt.format(new Date(t)); // en-CA yields YYYY-MM-DD
}

/** Today's NFL slate date (Eastern). */
export function todayNflSlate(now: Date = new Date()): string {
  return slateFmt.format(now);
}

/**
 * Given kickoff timestamps, choose the slate to show: today if any game kicks
 * off today, otherwise the next date with a game; null when nothing upcoming.
 */
export function pickSlateDate(kickoffsISO: string[], today: string): string | null {
  const dates = [...new Set(kickoffsISO.map(toNflSlateDate).filter(Boolean))].sort();
  if (dates.includes(today)) return today;
  return dates.find((d) => d > today) ?? null;
}

/** NFL season year for a slate date (Aug–Feb belong to the season that started in Aug's year). */
export function nflSeasonForDate(slate: string): { season: number; prior: number } {
  const [y, m] = slate.split("-").map(Number);
  const season = (m ?? 1) >= 8 ? y : y - 1;
  return { season, prior: season - 1 };
}

/** First day we treat as "this season" for gamelog splitting. */
export function seasonStartDate(season: number): string {
  return `${season}-08-01`;
}

/**
 * Which team-defense stat a prop is measured against. Receiving yards are
 * drawn from the pool of pass yards a defense allows, while receptions track
 * completions allowed — so they map to different families.
 */
export type StatFamily = "passYds" | "completions" | "rush" | "passTd" | "total";

export function statFamilyForProp(propType: string): StatFamily | null {
  switch (propType) {
    case "Passing Yards":
    case "Receiving Yards":
      return "passYds";
    case "Completions":
    case "Pass Attempts":
    case "Receptions":
      return "completions";
    case "Rushing Yards":
    case "Rush Attempts":
      return "rush";
    case "Pass TDs":
      return "passTd";
    case "Rush+Rec Yards":
      return "total";
    default:
      return null;
  }
}

/** Position group a prop's production comes from (for teammate-absence opportunity). */
export type PositionFamily = "pass" | "rush" | "rec" | "combo";

export function positionFamilyForProp(propType: string): PositionFamily | null {
  switch (propType) {
    case "Passing Yards":
    case "Completions":
    case "Pass Attempts":
    case "Pass TDs":
      return "pass";
    case "Rushing Yards":
    case "Rush Attempts":
      return "rush";
    case "Receiving Yards":
    case "Receptions":
      return "rec";
    case "Rush+Rec Yards":
      return "combo";
    default:
      return null;
  }
}

/** Props whose output is suppressed by wind/rain/cold (the passing game). */
export function isPassOrRecProp(propType: string): boolean {
  const fam = positionFamilyForProp(propType);
  return fam === "pass" || fam === "rec";
}

/** Position groups whose absence creates opportunity for a given prop. */
export function positionsBoostingProp(propType: string): string[] {
  switch (positionFamilyForProp(propType)) {
    case "rush":
      return ["RB", "FB"];
    case "rec":
      return ["WR", "TE"];
    case "combo":
      return ["RB", "WR", "TE"];
    default:
      return []; // a QB's opportunity doesn't grow when a teammate sits
  }
}
