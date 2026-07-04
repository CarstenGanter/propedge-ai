"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { parsePropsCsv, prepareRow, type PreparedProp } from "@/lib/ingest/props";

const REVALIDATE = ["/", "/picks", "/research", "/results"];
function revalidateAll() {
  for (const p of REVALIDATE) revalidatePath(p);
}

async function insertProps(props: PreparedProp[], isDemo = false) {
  if (props.length === 0) return 0;
  const created = await prisma.$transaction(
    props.map((p) =>
      prisma.playerProp.create({
        data: {
          date: p.date,
          sport: p.sport,
          league: p.league,
          playerName: p.playerName,
          team: p.team,
          opponent: p.opponent,
          propType: p.propType,
          line: p.line,
          direction: p.direction,
          source: p.source,
          gameStartTime: p.gameStartTime ? new Date(p.gameStartTime) : null,
          projection: p.projection,
          payoutMultiplier: p.payoutMultiplier,
          injuryStatus: p.injuryStatus,
          notes: p.notes,
          isDemo,
        },
      }),
    ),
  );
  return created.length;
}

interface ImportResult {
  ok: boolean;
  imported: number;
  errors: { row: number; message: string }[];
}

export async function importPropsFromCsv(csvText: string): Promise<ImportResult> {
  const { valid, errors } = parsePropsCsv(csvText);
  const imported = await insertProps(valid);
  revalidateAll();
  return { ok: errors.length === 0, imported, errors };
}

export async function addManualProp(
  input: Record<string, string>,
): Promise<ImportResult> {
  const result = prepareRow({ ...input, source: input.source || "Manual entry" });
  if (!result.ok) {
    return { ok: false, imported: 0, errors: [{ row: 1, message: result.message }] };
  }
  await insertProps([result.value]);
  revalidateAll();
  return { ok: true, imported: 1, errors: [] };
}

export async function deletePropAction(id: string): Promise<{ ok: boolean }> {
  await prisma.playerProp.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}
