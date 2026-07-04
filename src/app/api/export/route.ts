import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { toCsv } from "@/lib/utils/csv";

/**
 * CSV export: /api/export?type=picks|props|bankroll|results
 * Returns a downloadable CSV of the requested dataset.
 */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? "picks";

  let rows: Record<string, unknown>[] = [];
  let filename = "propedge-export.csv";

  if (type === "props") {
    const props = await prisma.playerProp.findMany({ orderBy: { date: "desc" } });
    filename = "propedge-props.csv";
    rows = props.map((p) => ({
      date: p.date,
      sport: p.sport,
      league: p.league,
      playerName: p.playerName,
      team: p.team,
      opponent: p.opponent,
      propType: p.propType,
      line: p.line,
      overUnder: p.direction,
      status: p.status,
      actualResult: p.actualResult ?? "",
      source: p.source,
      isDemo: p.isDemo,
    }));
  } else if (type === "bankroll") {
    const entries = await prisma.bankrollEntry.findMany({ orderBy: { date: "desc" } });
    filename = "propedge-bankroll.csv";
    rows = entries.map((e) => ({
      date: e.date,
      entryType: e.entryType,
      stake: e.stake,
      payout: e.payout,
      profitLoss: e.profitLoss,
      status: e.status,
      placedReal: e.placedReal,
      notes: e.notes ?? "",
      isDemo: e.isDemo,
    }));
  } else {
    // picks / results
    const picks = await prisma.pick.findMany({
      orderBy: [{ date: "desc" }, { rank: "asc" }],
      include: { playerProp: true },
    });
    filename = type === "results" ? "propedge-results.csv" : "propedge-picks.csv";
    rows = picks.map((pk) => ({
      date: pk.date,
      rank: pk.rank,
      sport: pk.playerProp.sport,
      playerName: pk.playerProp.playerName,
      team: pk.playerProp.team,
      opponent: pk.playerProp.opponent,
      propType: pk.playerProp.propType,
      line: pk.playerProp.line,
      direction: pk.playerProp.direction,
      confidenceScore: pk.confidenceScore,
      edgeScore: pk.edgeScore,
      riskLevel: pk.riskLevel,
      status: pk.status,
      actualResult: pk.actualResult ?? "",
      modelVersion: pk.modelVersion,
      isDemo: pk.isDemo,
    }));
  }

  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
