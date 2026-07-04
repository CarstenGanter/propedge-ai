import Link from "next/link";
import { Award, CalendarDays, ListChecks, TrendingDown } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard, EmptyState, SectionHeading } from "@/components/common";
import { StatusBadge, ConfidenceBadge, SportBadge, LeagueBadge, TeamStatusBadge, ValueBadge } from "@/components/badges";
import { ResultSettlementModal } from "@/components/ResultSettlementModal";
import { SettleAllButton } from "@/components/SettleAllButton";
import { SettleTeamsButton } from "@/components/SettleTeamsButton";
import { TeamSettlementModal } from "@/components/TeamPickActions";
import { Button } from "@/components/ui/button";
import {
  getResultsForDate,
  getDistinctPickDates,
  getTeamPicksForDate,
  getDistinctTeamPickDates,
} from "@/lib/queries";
import { computeRecord, computeTeamRecord, type PickRecord } from "@/lib/analytics";
import { formatPercent, formatSignedCurrency } from "@/lib/utils/format";
import { formatSlate, todaySlate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const [propDates, teamDates] = await Promise.all([getDistinctPickDates(), getDistinctTeamPickDates()]);
  const dates = [...new Set([...propDates, ...teamDates])].sort((a, b) => b.localeCompare(a));
  const date = params.date ?? dates[0] ?? todaySlate();

  const [picks, bankrollEntries, teamPicks] = await Promise.all([
    getResultsForDate(date),
    prisma.bankrollEntry.findMany({ where: { date } }),
    getTeamPicksForDate(date),
  ]);
  const teamRecord = computeTeamRecord(teamPicks.map((t) => ({ league: t.league, status: t.status })));
  const teamPlById = new Map<string, number>();
  for (const e of bankrollEntries) if (e.teamPickId) teamPlById.set(e.teamPickId, e.profitLoss);

  const plByPick = new Map<string, number>();
  for (const e of bankrollEntries) if (e.pickId) plByPick.set(e.pickId, e.profitLoss);
  const dailyPL = bankrollEntries
    .filter((e) => e.status !== "pending")
    .reduce((s, e) => s + e.profitLoss, 0);

  const record = computeRecord(
    picks.map(
      (p): PickRecord => ({
        sport: p.prop.sport,
        league: p.prop.league,
        propType: p.prop.propType,
        direction: p.prop.direction,
        confidenceScore: p.confidenceScore,
        status: p.status,
        date: p.date,
      }),
    ),
  );

  const settled = picks.filter((p) => p.status !== "pending");
  const hits = picks.filter((p) => p.status === "hit");
  const misses = picks.filter((p) => p.status === "miss");

  const overs = picks.filter((p) => p.prop.direction === "OVER" && (p.status === "hit" || p.status === "miss"));
  const unders = picks.filter((p) => p.prop.direction === "UNDER" && (p.status === "hit" || p.status === "miss"));
  const oversHit = overs.filter((p) => p.status === "hit").length;
  const undersHit = unders.filter((p) => p.status === "hit").length;

  const lessons: string[] = [];
  if (settled.length > 0) {
    if (overs.length) lessons.push(`Overs went ${oversHit}-${overs.length - oversHit} today.`);
    if (unders.length) lessons.push(`Unders went ${undersHit}-${unders.length - undersHit} today.`);
    const highConf = settled.filter((p) => p.confidenceScore >= 75);
    if (highConf.length) {
      const hc = highConf.filter((p) => p.status === "hit").length;
      lessons.push(`High-confidence picks (75+) hit ${hc}/${highConf.filter((p) => p.status !== "push" && p.status !== "void").length}.`);
    }
  }

  const biggestWin = [...hits].sort((a, b) => (plByPick.get(b.id) ?? 0) - (plByPick.get(a.id) ?? 0))[0];
  const worstMiss = [...misses].sort((a, b) => (plByPick.get(a.id) ?? 0) - (plByPick.get(b.id) ?? 0))[0];

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Results & Settlement"
        description={`End-of-day review for ${formatSlate(date)}. Auto-settle uses your data provider; otherwise settle manually.`}
        action={<SettleAllButton date={date} />}
      />

      {dates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {dates.slice(0, 10).map((d) => (
            <Button
              key={d}
              asChild
              size="sm"
              variant={d === date ? "default" : "ghost"}
            >
              <Link href={`/results?date=${d}`}>{d.slice(5)}</Link>
            </Button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Daily accuracy" value={formatPercent(record.hitRate)} sub={`${hits.length}-${misses.length} decided`} accent="primary" />
        <StatCard label="Daily P/L" value={formatSignedCurrency(dailyPL)} accent={dailyPL >= 0 ? "success" : "danger"} />
        <StatCard label="Settled" value={`${settled.length}/${picks.length}`} sub={`${picks.length - settled.length} pending`} />
        <StatCard label="Pushes / voids" value={picks.filter((p) => p.status === "push" || p.status === "void").length} />
      </div>

      {picks.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          title="No picks on this date"
          description="Generate picks on the Today's Picks page, then come back here to settle results."
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader><CardTitle className="flex items-center gap-2"><Award className="h-4 w-4 text-success" /> Biggest win</CardTitle></CardHeader>
              <CardContent>
                {biggestWin ? (
                  <div className="text-sm">
                    <p className="font-medium">{biggestWin.prop.playerName}</p>
                    <p className="text-muted-foreground">{biggestWin.prop.direction} {biggestWin.prop.line} {biggestWin.prop.propType}</p>
                    {plByPick.has(biggestWin.id) && (
                      <p className="mt-1 text-success">{formatSignedCurrency(plByPick.get(biggestWin.id)!)}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No wins recorded yet.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-danger" /> Worst miss</CardTitle></CardHeader>
              <CardContent>
                {worstMiss ? (
                  <div className="text-sm">
                    <p className="font-medium">{worstMiss.prop.playerName}</p>
                    <p className="text-muted-foreground">{worstMiss.prop.direction} {worstMiss.prop.line} {worstMiss.prop.propType}</p>
                    {plByPick.has(worstMiss.id) && (
                      <p className="mt-1 text-danger">{formatSignedCurrency(plByPick.get(worstMiss.id)!)}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No misses recorded yet.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Lessons learned</CardTitle></CardHeader>
              <CardContent>
                {lessons.length ? (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {lessons.map((l, i) => <li key={i}>• {l}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Settle picks to generate a recap.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Picks</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Prop</TableHead>
                    <TableHead>Conf.</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>P/L</TableHead>
                    <TableHead className="text-right">Settle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {picks.map((p) => {
                    const pl = plByPick.get(p.id);
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <SportBadge sport={p.prop.sport} />
                            <Link href={`/picks/${p.id}`} className="text-sm font-medium hover:text-primary">
                              {p.prop.playerName}
                            </Link>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.prop.direction} {p.prop.line} {p.prop.propType}
                        </TableCell>
                        <TableCell><ConfidenceBadge score={p.confidenceScore} /></TableCell>
                        <TableCell className="tabular-nums">{p.prop.actualResult ?? "—"}</TableCell>
                        <TableCell><StatusBadge status={p.status} /></TableCell>
                        <TableCell className={cn("tabular-nums", pl != null && pl >= 0 ? "text-success" : pl != null ? "text-danger" : "text-muted-foreground")}>
                          {pl != null ? formatSignedCurrency(pl) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <ResultSettlementModal pick={p} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {teamPicks.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Team games</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Record {teamRecord.wins}-{teamRecord.losses}
                {teamRecord.pushes ? `-${teamRecord.pushes}` : ""} · {formatPercent(teamRecord.winRate)} · {teamRecord.pending} pending
              </p>
            </div>
            <SettleTeamsButton date={date} />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Game</TableHead>
                  <TableHead>Pick</TableHead>
                  <TableHead>Win%</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>P/L</TableHead>
                  <TableHead className="text-right">Settle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamPicks.map((t) => {
                  const pl = teamPlById.get(t.id);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <LeagueBadge league={t.league} />
                          <Link href={`/teams/${t.id}`} className="text-xs text-muted-foreground hover:text-primary">
                            {t.awayTeam} @ {t.homeTeam}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-medium">{t.recommendedTeam}</TableCell>
                      <TableCell className="tabular-nums">{Math.round(t.winProbability * 100)}%</TableCell>
                      <TableCell><ValueBadge edge={t.valueEdge} /></TableCell>
                      <TableCell><TeamStatusBadge status={t.status} /></TableCell>
                      <TableCell className={cn("tabular-nums", pl != null && pl >= 0 ? "text-success" : pl != null ? "text-danger" : "text-muted-foreground")}>
                        {pl != null ? formatSignedCurrency(pl) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <TeamSettlementModal pick={t} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
