import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/common";
import { AccuracyChart, CalibrationChart, ProfitLossChart, TrendChart } from "@/components/charts";
import {
  getAllPickRecords,
  getAllTeamRecords,
  getBankrollRecords,
  getPropModelInputs,
  getTeamModelInputs,
  getLineEdgeInputs,
} from "@/lib/queries";
import { summarizeLineEdge, MIN_DECIDED_FOR_SIGNAL, type LineEdgeSummary } from "@/lib/analysis/lineEdge";
import { getSettings } from "@/lib/settings";
import {
  computeRecord,
  computeTeamRecord,
  cumulativePLSeries,
  filterRecords,
  groupRecords,
  profitLossBy,
  recordByDirection,
  recordByLeague,
  recordByPropType,
  recordBySport,
  summarizeBankroll,
  teamRecordByLeague,
  avgConfidenceWinnersVsLosers,
  type AccuracyScope,
  type GroupedRecord,
} from "@/lib/analytics";
import { AccuracyFilterBar } from "@/components/AccuracyFilterBar";
import { LEAGUE_LABELS, type League } from "@/lib/teamLeagues";
import { computeCalibration, recentTrend } from "@/lib/analysis/calibration";
import { brierScore, logLoss, brierSkillScore, clvSummary } from "@/lib/analysis/modelQuality";
import { CaptureClosingLinesButton } from "@/components/CaptureClosingLinesButton";
import { confidenceTier, CONFIDENCE_TIERS } from "@/lib/analysis/confidenceModel";
import { formatPercent, formatSignedCurrency } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; sport?: string }>;
}) {
  const params = await searchParams;
  const scope: AccuracyScope = params.scope === "mine" ? "mine" : "all";
  const sportParam = params.sport ?? "All";

  const [allRecords, bankroll, settings, teamRecords, propModel, teamModel, lineEdgeInputs] = await Promise.all([
    getAllPickRecords(),
    getBankrollRecords(),
    getSettings(),
    getAllTeamRecords(),
    getPropModelInputs(),
    getTeamModelInputs(),
    getLineEdgeInputs(sportParam === "All" ? undefined : sportParam),
  ]);
  const lineEdge = summarizeLineEdge(lineEdgeInputs);

  // Accuracy views are scoped; demo-seeded picks are excluded so synthetic
  // results never inflate a real hit rate.
  const realRecords = allRecords.filter((r) => !r.isDemo);
  const sportsPresent = [...new Set(realRecords.map((r) => r.sport))].sort();
  const sport = sportsPresent.includes(sportParam) ? sportParam : "All";
  const records = filterRecords(allRecords, { scope, sport });
  const mineCount = filterRecords(allRecords, { scope: "mine", sport }).length;
  const allCount = filterRecords(allRecords, { scope: "all", sport }).length;

  // ---- Model quality: calibration score (Brier / log-loss) + closing-line value ----
  const propCalib = propModel
    .filter((p) => p.status === "hit" || p.status === "miss")
    .map((p) => ({ p: p.confidenceScore / 100, hit: p.status === "hit" }));
  const teamCalib = teamModel
    .filter((t) => t.status === "win" || t.status === "loss")
    .map((t) => ({ p: t.winProbability, hit: t.status === "win" }));
  const propQuality = {
    brier: brierScore(propCalib),
    logLoss: logLoss(propCalib),
    skill: brierSkillScore(propCalib),
    n: propCalib.length,
  };
  const teamQuality = {
    brier: brierScore(teamCalib),
    logLoss: logLoss(teamCalib),
    skill: brierSkillScore(teamCalib),
    n: teamCalib.length,
  };
  const propClv = clvSummary(
    propModel
      .filter((p) => p.entryProb != null && p.closingProb != null)
      .map((p) => ({ entryProb: p.entryProb as number, closingProb: p.closingProb as number })),
  );
  const teamClv = clvSummary(
    teamModel
      .filter((t) => t.closingWinProb != null)
      .map((t) => ({ entryProb: t.marketWinProb, closingProb: t.closingWinProb as number })),
  );
  const teamOverall = computeTeamRecord(teamRecords);
  const teamByLeague = teamRecordByLeague(teamRecords);

  const overall = computeRecord(records);
  const summary = summarizeBankroll(bankroll, settings.bankrollStartingAmount);
  const bySport = recordBySport(records);
  const byLeague = recordByLeague(records);
  const byPropType = recordByPropType(records);
  const byDirection = recordByDirection(records);
  const byTier = groupRecords(records, (p) => confidenceTier(p.confidenceScore)).sort(
    (a, b) => CONFIDENCE_TIERS.indexOf(a.key as never) - CONFIDENCE_TIERS.indexOf(b.key as never),
  );
  const plBySport = profitLossBy(bankroll, (e) => e.sport);
  const plByProp = profitLossBy(bankroll, (e) => e.propType);
  const plSeries = cumulativePLSeries(bankroll, settings.bankrollStartingAmount);
  const calibration = computeCalibration(records);
  const trend = recentTrend(records);
  const confSplit = avgConfidenceWinnersVsLosers(records);

  const decidedGroups = [...bySport, ...byPropType].filter((g) => g.record.hits + g.record.misses >= 3);
  const best = [...decidedGroups].sort((a, b) => b.record.hitRate - a.record.hitRate)[0];
  const worst = [...decidedGroups].sort((a, b) => a.record.hitRate - b.record.hitRate)[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          {scope === "mine"
            ? "How the picks you actually took have performed."
            : "How every pick the model produced has performed."}{" "}
          {sport !== "All" && `${sport} only. `}
          Demo data is excluded. Past performance does not ensure future results.
        </p>
      </div>

      <AccuracyFilterBar
        scope={scope}
        sport={sport}
        sports={sportsPresent}
        mineCount={mineCount}
        allCount={allCount}
      />

      {scope === "mine" && mineCount === 0 && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-foreground/90">
          You haven&apos;t marked any picks as taken yet. On NFL Gameday or Today&apos;s Picks, click{" "}
          <span className="font-medium">I took this</span> on a pick and it will be scored here once the
          game settles.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Overall record" value={`${overall.hits}-${overall.misses}`} sub={`${overall.pushes + overall.voids} push/void`} />
        <StatCard label="Hit rate" value={formatPercent(overall.hitRate)} accent="primary" />
        <StatCard label="ROI" value={formatPercent(summary.roi)} accent={summary.roi >= 0 ? "success" : "danger"} />
        <StatCard label="All-time P/L" value={formatSignedCurrency(summary.profitLoss)} accent={summary.profitLoss >= 0 ? "success" : "danger"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Best category</CardTitle></CardHeader>
          <CardContent>
            {best ? (
              <p className="text-sm"><span className="font-semibold text-success">{best.key}</span> — {formatPercent(best.record.hitRate)} ({best.record.hits}-{best.record.misses})</p>
            ) : <p className="text-sm text-muted-foreground">Need ≥3 decided picks in a category.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Worst category</CardTitle></CardHeader>
          <CardContent>
            {worst ? (
              <p className="text-sm"><span className="font-semibold text-danger">{worst.key}</span> — {formatPercent(worst.record.hitRate)} ({worst.record.hits}-{worst.record.misses})</p>
            ) : <p className="text-sm text-muted-foreground">Need ≥3 decided picks in a category.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Confidence signal</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Winning picks averaged <span className="font-semibold text-success">{confSplit.winners}</span> confidence vs{" "}
            <span className="font-semibold text-danger">{confSplit.losers}</span> for losers.
          </CardContent>
        </Card>
      </div>

      {teamOverall.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Team picks (game winners)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Record {teamOverall.wins}-{teamOverall.losses}
              {teamOverall.pushes ? `-${teamOverall.pushes}` : ""} · {formatPercent(teamOverall.winRate)} win rate ·{" "}
              {teamOverall.pending} pending
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {teamByLeague
                .filter((g) => g.record.total > 0)
                .map(({ league, record }) => {
                  const decided = record.wins + record.losses;
                  return (
                    <div key={league} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                      <span className="truncate">{LEAGUE_LABELS[league as League] ?? league}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {record.wins}-{record.losses}
                        {record.pushes ? `-${record.pushes}` : ""}
                      </span>
                      <span className="w-14 text-right font-medium tabular-nums">
                        {decided ? formatPercent(record.winRate, 0) : "—"}
                      </span>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="accuracy">
        <TabsList>
          <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
          <TabsTrigger value="pl">Profit / Loss</TabsTrigger>
          <TabsTrigger value="calibration">Calibration</TabsTrigger>
          <TabsTrigger value="quality">Model quality</TabsTrigger>
        </TabsList>

        <TabsContent value="accuracy" className="space-y-4">
          <LineEdgeCard summary={lineEdge} />
          <Card>
            <CardHeader>
              <CardTitle>Accuracy by prop type</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Hit rate for each kind of pick — passing yards, receptions, rush attempts and so on.
                A rate is only shown once a category has at least {MIN_SAMPLE} decided picks, because
                anything less is noise rather than a trend.
              </p>
            </CardHeader>
            <CardContent><RecordTable groups={byPropType} showSample /></CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Hit rate by sport</CardTitle></CardHeader>
              <CardContent><AccuracyChart data={bySport} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>By confidence tier</CardTitle></CardHeader>
              <CardContent><RecordTable groups={byTier} showSample /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>By direction & league</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <RecordTable groups={byDirection} showSample />
                <RecordTable groups={byLeague} showSample />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Still pending</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {overall.pending > 0 ? (
                  <>
                    <span className="font-medium text-foreground">{overall.pending}</span> pick
                    {overall.pending === 1 ? "" : "s"} not settled yet. Results auto-settle from ESPN box
                    scores the morning after a game, or settle them by hand on the Results page.
                  </>
                ) : (
                  "Everything in this view has been settled."
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pl" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Bankroll over time</CardTitle></CardHeader>
            <CardContent><ProfitLossChart data={plSeries} /></CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>P/L by sport</CardTitle></CardHeader>
              <CardContent><PLTable rows={plBySport} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>P/L by prop type</CardTitle></CardHeader>
              <CardContent><PLTable rows={plByProp} /></CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="calibration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Confidence calibration</CardTitle>
              <p className="text-xs text-muted-foreground">Did 80%-confidence picks actually hit ~80%? Closer lines = better calibrated.</p>
            </CardHeader>
            <CardContent><CalibrationChart data={calibration} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent performance trend</CardTitle></CardHeader>
            <CardContent><TrendChart data={trend} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Closing Line Value (CLV)</CardTitle>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  Did the market move toward your side after you took it? Positive CLV — beating the
                  closing line — is the strongest leading indicator of real edge, independent of any
                  single result. Capture closing lines near game time to populate this.
                </p>
              </div>
              <CaptureClosingLinesButton />
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <ClvCard title="Team picks (moneyline)" clv={teamClv} />
              <ClvCard title="Player props" clv={propClv} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Calibration score — player props</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  How well confidence maps to reality (confidence ÷ 100 as the predicted hit rate).
                </p>
              </CardHeader>
              <CardContent><QualityTable q={propQuality} /></CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Calibration score — team picks</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Model win probability vs. realized wins.</p>
              </CardHeader>
              <CardContent><QualityTable q={teamQuality} /></CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClvCard({
  title,
  clv,
}: {
  title: string;
  clv: { count: number; avgClv: number; beatCloseRate: number; positive: number; negative: number };
}) {
  if (clv.count === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">No closing lines captured yet.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Avg CLV</span>
          <span className={cn("font-medium tabular-nums", clv.avgClv >= 0 ? "text-success" : "text-danger")}>
            {clv.avgClv >= 0 ? "+" : ""}
            {clv.avgClv.toFixed(2)} pts
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Beat the close</span>
          <span className="font-medium tabular-nums">{clv.beatCloseRate.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Captured</span>
          <span className="tabular-nums text-muted-foreground">
            {clv.count} ({clv.positive}↑ / {clv.negative}↓)
          </span>
        </div>
      </div>
    </div>
  );
}

function QualityTable({
  q,
}: {
  q: { brier: number | null; logLoss: number | null; skill: number | null; n: number };
}) {
  if (q.n === 0) return <p className="text-sm text-muted-foreground">No decided picks yet.</p>;
  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Brier score</span>
        <span className="font-medium tabular-nums">{q.brier?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Log loss</span>
        <span className="font-medium tabular-nums">{q.logLoss?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Skill vs. coin flip</span>
        <span className={cn("font-medium tabular-nums", (q.skill ?? 0) >= 0 ? "text-success" : "text-danger")}>
          {q.skill == null ? "—" : `${(q.skill * 100).toFixed(0)}%`}
        </span>
      </div>
      <p className="pt-1 text-xs text-muted-foreground">
        {q.n} decided picks · lower Brier/log-loss is better · skill &gt; 0 beats a coin flip.
      </p>
    </div>
  );
}

function LineEdgeCard({ summary }: { summary: LineEdgeSummary }) {
  if (summary.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Is line shopping working?</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Enter the line your pick&apos;em app posts on a few picks and this will start measuring
            whether those lines are actually softer than the sportsbooks&apos;.
          </p>
        </CardHeader>
      </Card>
    );
  }
  const { softer, identical, tougher } = summary.buckets;
  const rows: { label: string; rec: typeof softer; note: string }[] = [
    { label: "Pick'em line was softer", rec: softer, note: "the edge you are hoping for" },
    { label: "Identical to the book", rec: identical, note: "no edge either way" },
    { label: "Pick'em line was tougher", rec: tougher, note: "negative edge" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Is line shopping working?</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          In fixed-multiplier pick&apos;em the structural edge comes from your app posting a softer
          number than the sharp books. This tests that claim directly instead of assuming it.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {rows.map(({ label, rec, note }) => {
            const decided = rec.hits + rec.misses;
            const share = summary.total > 0 ? (rec.count / summary.total) * 100 : 0;
            return (
              <div key={label} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                <span className="truncate">
                  {label}
                  <span className="ml-1.5 text-xs text-muted-foreground">{note}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {rec.count} of {summary.total} ({share.toFixed(0)}%)
                </span>
                <span className="w-24 text-right tabular-nums">
                  {decided >= MIN_SAMPLE && rec.hitRate != null
                    ? formatPercent(rec.hitRate, 0)
                    : `${rec.hits}-${rec.misses}`}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {summary.identicalShare != null && summary.identicalShare >= 0.6 ? (
            <>
              Your pick&apos;em app matched the book on{" "}
              <span className="font-medium text-warning">
                {formatPercent(summary.identicalShare * 100, 0)}
              </span>{" "}
              of these props. Where the lines agree there is no line edge to win, so results there come
              down to the model and to variance.
            </>
          ) : (
            <>
              Average difference {summary.averageEdge == null ? "—" : summary.averageEdge.toFixed(2)} stat
              units in your favour across {summary.total} props.
            </>
          )}{" "}
          {summary.conclusive
            ? "There is now enough settled data to compare these rows."
            : `Not yet conclusive — needs at least ${MIN_DECIDED_FOR_SIGNAL} decided picks with a good number on a softer line.`}
        </p>
      </CardContent>
    </Card>
  );
}

/** Below this many decided picks a hit rate is noise, so we show the record only. */
const MIN_SAMPLE = 5;

function RecordTable({ groups, showSample = false }: { groups: GroupedRecord[]; showSample?: boolean }) {
  const rows = groups.filter((g) => g.record.total > 0);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    <div className="space-y-2">
      {rows.map(({ key, record }) => {
        const decided = record.hits + record.misses;
        const enough = decided >= MIN_SAMPLE;
        return (
          <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
            <span className="truncate">
              {key}
              {showSample && record.pending > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">+{record.pending} pending</span>
              )}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {record.hits}-{record.misses}
              {record.pushes ? `-${record.pushes}` : ""}
            </span>
            <span
              className={cn(
                "w-24 text-right font-medium tabular-nums",
                enough ? "text-foreground" : "text-muted-foreground",
              )}
              title={enough ? undefined : `Only ${decided} decided pick(s) — too few to read a rate from.`}
            >
              {!decided ? "—" : enough ? formatPercent(record.hitRate, 0) : `${decided} decided`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PLTable({ rows }: { rows: { key: string; profitLoss: number; roi: number; count: number }[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No settled wagers yet.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
          <span className="truncate">{r.key}</span>
          <span className="text-muted-foreground tabular-nums">ROI {formatPercent(r.roi, 0)}</span>
          <span className={cn("w-20 text-right font-medium tabular-nums", r.profitLoss >= 0 ? "text-success" : "text-danger")}>
            {formatSignedCurrency(r.profitLoss)}
          </span>
        </div>
      ))}
    </div>
  );
}
