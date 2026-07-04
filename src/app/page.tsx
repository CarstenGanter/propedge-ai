import Link from "next/link";
import { Activity, DollarSign, Percent, Target, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, EmptyState, SectionHeading } from "@/components/common";
import { PickCard } from "@/components/PickCard";
import { DemoDataBadge } from "@/components/badges";
import {
  getAllPickRecords,
  getAllTeamRecords,
  getBankrollRecords,
  getLatestPickDate,
  getPicksForDate,
  getPendingPicks,
} from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { computeRecord, computeTeamRecord, summarizeBankroll } from "@/lib/analytics";
import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/utils/format";
import { formatSlate, isoWeekKey, monthKey, todaySlate } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [settings, records, bankroll, latestDate, pending, teamRecords] = await Promise.all([
    getSettings(),
    getAllPickRecords(),
    getBankrollRecords(),
    getLatestPickDate(),
    getPendingPicks(),
    getAllTeamRecords(),
  ]);

  const record = computeRecord(records);
  const teamRecord = computeTeamRecord(teamRecords);
  const summary = summarizeBankroll(bankroll, settings.bankrollStartingAmount);
  const today = todaySlate();
  const settledEntries = bankroll.filter((b) => b.status !== "pending");
  const sumPL = (rows: typeof settledEntries) => rows.reduce((s, b) => s + b.profitLoss, 0);
  const dailyPL = sumPL(settledEntries.filter((b) => b.date === today));
  const weekPL = sumPL(settledEntries.filter((b) => isoWeekKey(b.date) === isoWeekKey(today)));
  const monthPL = sumPL(settledEntries.filter((b) => monthKey(b.date) === monthKey(today)));

  const displayDate = latestDate ?? today;
  const topPicks = latestDate ? (await getPicksForDate(latestDate)).slice(0, 5) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Dashboard {settings.demoMode && <DemoDataBadge className="ml-2 align-middle" />}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your prop research command center. All picks carry risk.
          </p>
        </div>
        <Button asChild>
          <Link href="/picks">
            <Target className="h-4 w-4" /> Go to Today's Picks
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Bankroll"
          value={formatCurrency(summary.currentBankroll)}
          sub={`Start ${formatCurrency(summary.startingAmount)}`}
          accent={summary.currentBankroll >= summary.startingAmount ? "success" : "danger"}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          label="All-time P/L"
          value={formatSignedCurrency(summary.profitLoss)}
          sub={`ROI ${formatPercent(summary.roi)}`}
          accent={summary.profitLoss >= 0 ? "success" : "danger"}
          icon={<DollarSign className="h-5 w-5" />}
        />
        <StatCard
          label="Today's P/L"
          value={formatSignedCurrency(dailyPL)}
          sub={formatSlate(today)}
          accent={dailyPL >= 0 ? "success" : "danger"}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label="Hit rate"
          value={formatPercent(record.hitRate)}
          sub={`${record.hits}-${record.misses}${record.pushes ? `-${record.pushes}` : ""} record`}
          accent="primary"
          icon={<Percent className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <SectionHeading
            title="Top picks"
            description={topPicks.length ? formatSlate(displayDate) : "Latest slate"}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/picks">View all →</Link>
              </Button>
            }
          />
          {topPicks.length === 0 ? (
            <EmptyState
              icon={<Target className="h-8 w-8" />}
              title="No picks yet"
              description="Generate today's picks from imported props, or load demo data in Settings."
              action={
                <Button asChild>
                  <Link href="/picks">Generate picks</Link>
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {topPicks.map((p, i) => (
                <PickCard key={p.id} pick={p} defaultOpen={i === 0} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Total picks" value={record.total} />
              <Row label="Settled" value={record.settled} />
              <Row label="Pending" value={pending.length} />
              <Row label="Pushes / voids" value={record.pushes + record.voids} />
              <Row label="Wagers won" value={summary.wins} />
              <Row label="Wagers lost" value={summary.losses} />
              <Row label="Amount staked" value={formatCurrency(summary.staked)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profit / loss by period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <PLRow label="Today" value={dailyPL} />
              <PLRow label="This week" value={weekPL} />
              <PLRow label="This month" value={monthPL} />
              <PLRow label="All-time" value={summary.profitLoss} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button asChild variant="secondary"><Link href="/teams">Team picks (winners)</Link></Button>
              <Button asChild variant="secondary"><Link href="/research">Import / add props</Link></Button>
              <Button asChild variant="secondary"><Link href="/results">Settle results</Link></Button>
              <Button asChild variant="secondary"><Link href="/parlays">Build a parlay</Link></Button>
              <Button asChild variant="secondary"><Link href="/analytics">View analytics</Link></Button>
            </CardContent>
          </Card>

          {teamRecord.total > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" /> Team picks
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Record" value={`${teamRecord.wins}-${teamRecord.losses}${teamRecord.pushes ? `-${teamRecord.pushes}` : ""}`} />
                <Row label="Win rate" value={formatPercent(teamRecord.winRate)} />
                <Row label="Pending" value={teamRecord.pending} />
                <Button asChild variant="ghost" size="sm" className="w-full"><Link href="/teams">Go to Team Picks →</Link></Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function PLRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={value >= 0 ? "font-medium tabular-nums text-success" : "font-medium tabular-nums text-danger"}>
        {formatSignedCurrency(value)}
      </span>
    </div>
  );
}
