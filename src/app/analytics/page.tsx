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
  assessRate,
  avgConfidenceWinnersVsLosers,
  computeRecord,
  computeTeamRecord,
  cumulativePLSeries,
  defaultSport,
  filterRecords,
  groupRecords,
  profitLossBy,
  recordByDirection,
  recordByLeague,
  recordByPropType,
  recordBySport,
  significantGroups,
  summarizeBankroll,
  teamRecordByLeague,
  wilsonInterval,
  type AccuracyScope,
  type GroupedRecord,
  type RateAssessment,
} from "@/lib/analytics";
import { breakEvenPerLeg } from "@/lib/analysis/pickemMath";
import { PICKEM_MULTIPLIERS } from "@/lib/analysis/slipBuilder";
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
  // Default to the sport actually being bet rather than pooling every sport the
  // board has ever touched. A retired sport averaged into the headline answers a
  // question nobody asked, and can dominate it outright.
  const sport = sportsPresent.includes(sportParam)
    ? sportParam
    : params.sport === "All"
      ? "All"
      : defaultSport(realRecords);
  const records = filterRecords(allRecords, { scope, sport });
  const mineCount = filterRecords(allRecords, { scope: "mine", sport }).length;
  const allCount = filterRecords(allRecords, { scope: "all", sport }).length;

  // ---- Model quality: calibration score (Brier / log-loss) + closing-line value ----
  // Brier and log-loss require confidence to *be* a probability, which is only
  // true for the distribution profile. Pooling the older blended scores would
  // grade two different scales against each other and mean nothing.
  const calibratable = propModel.filter((p) => p.scoringProfile === "distribution");
  const propCalib = calibratable
    .filter((p) => p.status === "hit" || p.status === "miss")
    .map((p) => ({ p: p.confidenceScore / 100, hit: p.status === "hit" }));
  const nonProbabilityDecided = propModel.filter(
    (p) => p.scoringProfile !== "distribution" && (p.status === "hit" || p.status === "miss"),
  ).length;
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
  // The calibration curve has the same requirement as Brier: a probability.
  const calibrationRecords = records.filter((r) => r.scoringProfile === "distribution");
  const calibration = computeCalibration(calibrationRecords);
  const trend = recentTrend(records);
  const confSplit = avgConfidenceWinnersVsLosers(records);

  // The bar a leg has to clear, not zero. Pick'em pays nothing for being good;
  // it pays for being above a specific number set by the multiplier.
  const REFERENCE_LEGS = 3;
  const barPercent = (breakEvenPerLeg(PICKEM_MULTIPLIERS[REFERENCE_LEGS], REFERENCE_LEGS) ?? 0.55) * 100;
  const verdict = assessRate(overall.hits, overall.misses, barPercent);
  const significance = significantGroups([...byPropType, ...byDirection]);

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
        <StatCard
          label="Hit rate"
          value={verdict.hitRate == null ? "—" : formatPercent(verdict.hitRate)}
          sub={verdict.interval ? `95% range ${verdict.interval.low.toFixed(0)}–${verdict.interval.high.toFixed(0)}%` : undefined}
          accent="primary"
        />
        <StatCard label="ROI" value={formatPercent(summary.roi)} accent={summary.roi >= 0 ? "success" : "danger"} />
        <StatCard label="All-time P/L" value={formatSignedCurrency(summary.profitLoss)} accent={summary.profitLoss >= 0 ? "success" : "danger"} />
      </div>

      <BarVerdictCard verdict={verdict} bar={barPercent} legs={REFERENCE_LEGS} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SignificanceCard significance={significance} />
        <Card>
          <CardHeader>
            <CardTitle>Confidence signal</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Whether a higher model score actually means a better pick.
            </p>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Winning picks averaged <span className="font-semibold text-success">{confSplit.winners}</span> vs{" "}
              <span className="font-semibold text-danger">{confSplit.losers}</span> for losers, over{" "}
              {confSplit.winnerCount + confSplit.loserCount} decided picks.
            </p>
            <p className="text-xs">
              A gap here is only meaningful if it is large and consistent. Compare the confidence tiers
              on the Accuracy tab — if the top tier does not out-hit the bottom, the score is not yet
              carrying information, whatever this average says.
            </p>
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
                  How well the stated probability matches reality. Counts only picks scored by the
                  Probability model, where confidence genuinely is a percentage.
                  {nonProbabilityDecided > 0 && (
                    <>
                      {" "}
                      <span className="text-warning">
                        {nonProbabilityDecided} older decided pick
                        {nonProbabilityDecided === 1 ? "" : "s"} excluded
                      </span>{" "}
                      — they were scored on a 0-100 lean scale, which cannot be graded as a
                      probability.
                    </>
                  )}
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

/**
 * The headline judgement: is this record above the bar it has to clear, and is
 * there enough of it to believe? A bare hit rate cannot answer either question.
 */
function BarVerdictCard({
  verdict,
  bar,
  legs,
}: {
  verdict: RateAssessment;
  bar: number;
  legs: number;
}) {
  const multiplier = PICKEM_MULTIPLIERS[legs];
  if (verdict.decided === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Are these picks good enough to bet?</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Nothing settled yet. A {legs}-leg slip at {multiplier}× needs every leg to hit{" "}
            {formatPercent(bar, 1)} just to break even.
          </p>
        </CardHeader>
      </Card>
    );
  }
  const { hitRate, interval } = verdict;
  // Written out rather than interpolated: Tailwind only emits classes it can
  // see as literal strings, so `text-${tone}` would render unstyled.
  const toneClass = verdict.clearsBar
    ? "text-success"
    : verdict.belowBar
      ? "text-danger"
      : "text-warning";
  const headline = verdict.clearsBar
    ? "Yes — the whole range clears the bar."
    : verdict.belowBar
      ? "No — the whole range sits below the bar."
      : "Not yet provable either way.";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Are these picks good enough to bet?</CardTitle>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Pick&apos;em pays nothing for a good hit rate — it pays for clearing the break-even bar set by
          your multiplier. A {legs}-leg slip at {multiplier}× needs {formatPercent(bar, 1)} per leg.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={cn("text-xl font-bold", toneClass)}>{headline}</span>
        </div>
        <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <span className="text-muted-foreground">This record</span>
          <span className="tabular-nums">
            {formatPercent(hitRate ?? 0)} over {verdict.decided} decided pick
            {verdict.decided === 1 ? "" : "s"}
            {interval && (
              <span className="text-muted-foreground">
                {" "}
                — could plausibly be anywhere from {interval.low.toFixed(1)}% to {interval.high.toFixed(1)}%
              </span>
            )}
          </span>
          <span className="text-muted-foreground">Bar to clear</span>
          <span className="tabular-nums">{formatPercent(bar, 1)} per leg</span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">
          {verdict.clearsBar
            ? "Even the pessimistic end of the range is above break-even, so this is evidenced rather than hoped for."
            : verdict.belowBar
              ? "Even the optimistic end of the range falls short. These picks have not been profitable at this multiplier."
              : `The range spans the bar, so this record is consistent with a real edge and with a coin flip alike. Separating the two from results alone takes on the order of a thousand slips — which is why closing-line value, on the Model quality tab, is the measurement worth watching instead.`}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Replaces a "best/worst category" leaderboard. Ranking ~15 categories at
 * n=5..18 nominates a winner and a loser every time regardless of whether
 * anything is real, and with that many comparisons about one spurious result is
 * expected by chance. Reporting the count of categories that actually separate
 * from chance is the honest version of the same card.
 */
function SignificanceCard({
  significance,
}: {
  significance: { separating: GroupedRecord[]; tested: number; nearest: GroupedRecord | null };
}) {
  const { separating, tested, nearest } = significance;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Anything here beating chance?</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Categories whose 95% range excludes 50%. Tested {tested} categor{tested === 1 ? "y" : "ies"}{" "}
          with enough decided picks to test.
        </p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {separating.length === 0 ? (
          <>
            <p className="font-semibold text-warning">Nothing yet.</p>
            <p className="text-xs leading-snug text-muted-foreground">
              No category has separated from a coin flip. That is the expected state this early and not
              a sign anything is broken — sample sizes here are in the teens, where a 60% and a 45% rate
              are statistically the same result.
              {nearest && (
                <>
                  {" "}
                  Closest is <span className="font-medium text-foreground">{nearest.key}</span> at{" "}
                  {formatPercent(nearest.record.hitRate, 0)} ({nearest.record.hits}-{nearest.record.misses}).
                </>
              )}
            </p>
          </>
        ) : (
          <>
            {separating.map(({ key, record }) => {
              const ci = wilsonInterval(record.hits, record.hits + record.misses);
              return (
                <div key={key} className="grid grid-cols-[1fr_auto] items-baseline gap-3">
                  <span className="truncate font-medium">{key}</span>
                  <span className="tabular-nums">
                    {formatPercent(record.hitRate, 0)}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({ci ? `${ci.low.toFixed(0)}–${ci.high.toFixed(0)}%` : "—"}, {record.hits}-{record.misses})
                    </span>
                  </span>
                </div>
              );
            })}
            <p className="pt-1 text-xs leading-snug text-muted-foreground">
              With {tested} categories tested at once, roughly one spurious result is expected by chance.
              Treat a single separating category as a lead, not a finding.
            </p>
          </>
        )}
      </CardContent>
    </Card>
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
        const ci = wilsonInterval(record.hits, decided);
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
                "w-32 text-right tabular-nums",
                enough ? "font-medium text-foreground" : "text-muted-foreground",
              )}
              title={
                ci
                  ? `${decided} decided — the true rate is 95% likely to be between ${ci.low.toFixed(0)}% and ${ci.high.toFixed(0)}%.`
                  : undefined
              }
            >
              {!decided ? (
                "—"
              ) : enough ? (
                <>
                  {formatPercent(record.hitRate, 0)}
                  {/* The range is the honest part: without it a rate off 6 picks
                      and a rate off 600 are indistinguishable on the page. */}
                  {ci && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {ci.low.toFixed(0)}–{ci.high.toFixed(0)}
                    </span>
                  )}
                </>
              ) : (
                `${decided} decided`
              )}
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
