import { z } from "zod";
import { parseCsv } from "@/lib/utils/csv";
import { DIRECTIONS, SPORTS, type Direction } from "@/types";

/** Normalized prop ready to persist (a subset of the Prisma PlayerProp model). */
export interface PreparedProp {
  date: string;
  sport: string;
  league: string;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: number;
  direction: Direction;
  source: string;
  gameStartTime: string | null;
  projection: number | null;
  payoutMultiplier: number | null;
  injuryStatus: string | null;
  notes: string | null;
}

export interface IngestResult {
  valid: PreparedProp[];
  errors: { row: number; message: string }[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDirection(v: string): Direction | null {
  const s = v.trim().toLowerCase();
  if (["over", "o", "higher", "more"].includes(s)) return "OVER";
  if (["under", "u", "lower", "less"].includes(s)) return "UNDER";
  const upper = v.trim().toUpperCase();
  return (DIRECTIONS as string[]).includes(upper) ? (upper as Direction) : null;
}

function optionalNumber(v: unknown): number | null {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const rowSchema = z.object({
  sport: z.string().min(1, "sport is required"),
  league: z.string().min(1, "league is required"),
  gameDate: z.string().regex(DATE_RE, "gameDate must be YYYY-MM-DD"),
  playerName: z.string().min(1, "playerName is required"),
  team: z.string().min(1, "team is required"),
  opponent: z.string().min(1, "opponent is required"),
  propType: z.string().min(1, "propType is required"),
  line: z.coerce.number(),
  overUnder: z.string().min(1, "overUnder is required"),
  source: z.string().min(1).optional(),
  startTime: z.string().optional(),
  projection: z.string().optional(),
  payoutMultiplier: z.string().optional(),
  injuryStatus: z.string().optional(),
  notes: z.string().optional(),
});

export function prepareRow(
  raw: Record<string, unknown>,
): { ok: true; value: PreparedProp } | { ok: false; message: string } {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: `${first.path.join(".") || "row"}: ${first.message}` };
  }
  const r = parsed.data;

  const direction = normalizeDirection(r.overUnder);
  if (!direction) {
    return { ok: false, message: `overUnder must be OVER/UNDER (got "${r.overUnder}")` };
  }

  const sport = SPORTS.find((s) => s.toLowerCase() === r.sport.trim().toLowerCase()) ?? r.sport.trim();

  let gameStartTime: string | null = null;
  if (r.startTime && r.startTime.trim()) {
    const d = new Date(r.startTime);
    gameStartTime = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return {
    ok: true,
    value: {
      date: r.gameDate,
      sport,
      league: r.league.trim(),
      playerName: r.playerName.trim(),
      team: r.team.trim(),
      opponent: r.opponent.trim(),
      propType: r.propType.trim(),
      line: r.line,
      direction,
      source: r.source?.trim() || "CSV import",
      gameStartTime,
      projection: optionalNumber(r.projection),
      payoutMultiplier: optionalNumber(r.payoutMultiplier),
      injuryStatus: r.injuryStatus?.trim() || null,
      notes: r.notes?.trim() || null,
    },
  };
}

/** Parse & validate a CSV string of Underdog props. */
export function parsePropsCsv(text: string): IngestResult {
  const { headers, rows } = parseCsv(text);
  const errors: IngestResult["errors"] = [];
  const valid: PreparedProp[] = [];

  const required = [
    "sport",
    "league",
    "gameDate",
    "playerName",
    "team",
    "opponent",
    "propType",
    "line",
    "overUnder",
  ];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length) {
    return {
      valid: [],
      errors: [{ row: 0, message: `Missing required column(s): ${missing.join(", ")}` }],
    };
  }

  rows.forEach((row, idx) => {
    const result = prepareRow(row);
    if (result.ok) valid.push(result.value);
    else errors.push({ row: idx + 2, message: result.message }); // +2 => 1-based incl. header
  });

  return { valid, errors };
}

export const CSV_TEMPLATE_HEADERS = [
  "sport",
  "league",
  "gameDate",
  "playerName",
  "team",
  "opponent",
  "propType",
  "line",
  "overUnder",
  "startTime",
  "projection",
  "payoutMultiplier",
  "injuryStatus",
  "notes",
];
