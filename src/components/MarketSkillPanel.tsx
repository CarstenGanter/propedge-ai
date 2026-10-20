import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, StatCard } from "@/components/common";
import type { Interval, SkillBreakdown } from "@/lib/analysis/marketSkill";
import type { OverGapRow, SkillSection } from "@/lib/predictionReport";
import { cn } from "@/lib/utils/cn";

function pct(x: number, digits = 2) {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
}

function interval(iv: Interval | null, digits = 2) {
  return iv ? `${pct(iv.lo, digits)} to ${pct(iv.hi, digits)}` : "—";
}

/** Green or red only when the interval excludes zero; otherwise it is not a finding. */
function tone(iv: Interval | null) {
  if (!iv) return "text-muted-foreground";
  if (iv.lo > 0) return "text-success";
  if (iv.hi < 0) return "text-danger";
  return "text-foreground";
}

function BreakdownTable({ title, rows }: { title: string; rows: SkillBreakdown[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead className="text-right">Props</TableHead>
            <TableHead className="text-right">Games</TableHead>
            <TableHead className="text-right">Skill vs market</TableHead>
            <TableHead className="text-right">95% interval</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell>{r.key}</TableCell>
              <TableCell className="text-right font-mono">{r.score.n}</TableCell>
              <TableCell className="text-right font-mono">{r.score.games}</TableCell>
              <TableCell className={cn("text-right font-mono", tone(r.interval))}>{pct(r.score.skill)}</TableCell>
              <TableCell className="text-right font-mono text-muted-foreground">{interval(r.interval)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Section({ s }: { s: SkillSection }) {
  const r = s.report;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{s.title}</CardTitle>
        <CardDescription>{s.note}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!r?.overall ? (
          <EmptyState title="No scored props yet" description="Rows appear here once their games are graded (npm run research:skill)." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
              <StatCard label="Log-loss skill vs market" value={<span className={tone(r.interval)}>{pct(r.overall.skill)}</span>} sub={`95%: ${interval(r.interval)}`} />
              <StatCard label="Model log-loss" value={r.overall.llModel.toFixed(4)} sub={`Market ${r.overall.llMarket.toFixed(4)}`} />
              <StatCard label="Props scored" value={r.overall.n} />
              <StatCard label="Games (the real sample)" value={r.overall.games} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <BreakdownTable title="By prop type" rows={r.byPropType} />
              <BreakdownTable title="By the side the model leans" rows={r.byLean} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Claimed edge vs what happened — hits on the model&apos;s side minus the hits the market expected there
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claimed edge (pts)</TableHead>
                    <TableHead className="text-right">Props</TableHead>
                    <TableHead className="text-right">Mean claimed</TableHead>
                    <TableHead className="text-right">Excess hits (pts)</TableHead>
                    <TableHead className="text-right">95% interval</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.buckets.map((b) => (
                    <TableRow key={b.label}>
                      <TableCell>{b.label}</TableCell>
                      <TableCell className="text-right font-mono">{b.n}</TableCell>
                      <TableCell className="text-right font-mono">{b.meanClaimedPts.toFixed(1)}</TableCell>
                      <TableCell className="text-right font-mono">{b.excessPts >= 0 ? "+" : ""}{b.excessPts.toFixed(1)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {b.excessInterval ? `${b.excessInterval.lo.toFixed(1)} to ${b.excessInterval.hi.toFixed(1)}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-xs text-muted-foreground">
                A real edge would rise from bucket to bucket. Flat or falling means the claimed edge is noise.
              </p>
            </div>
            <BreakdownTable title="By edge source" rows={r.byEdgeSource} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The headline test: does the model's probability carry information the
 * de-vigged consensus does not? Scored on every settled prop with a market,
 * intervals from resampling whole games.
 */
function OverGapCard({ rows }: { rows: OverGapRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The Over against the books, at venue lines</CardTitle>
        <CardDescription>
          How often the Over landed minus how often the books said it would, per prop. Negative means Overs finish
          below the books&apos; probability — the public-leans-Over shading the research expects. A standing metric:
          it only means something once its interval excludes zero.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Games</TableHead>
              <TableHead className="text-right">Over − books (pts)</TableHead>
              <TableHead className="text-right">95% interval</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right font-mono">{r.gap?.n ?? 0}</TableCell>
                <TableCell className="text-right font-mono">{r.gap?.games ?? 0}</TableCell>
                <TableCell className={cn("text-right font-mono", r.gap?.interval && (r.gap.interval.hi < 0 || r.gap.interval.lo > 0) ? "font-semibold" : "")}>
                  {r.gap ? `${r.gap.gapPts >= 0 ? "+" : ""}${r.gap.gapPts.toFixed(1)}` : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {r.gap?.interval ? `${r.gap.interval.lo.toFixed(1)} to ${r.gap.interval.hi.toFixed(1)}` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function MarketSkillPanel({
  sections,
  roi,
  overGap,
}: {
  sections: SkillSection[];
  roi: { n: number; roi: number } | null;
  overGap: OverGapRow[];
}) {
  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
        Skill = 1 − model log-loss ÷ market log-loss on the same props. Above zero, the model adds information the books
        don&apos;t have; at zero it <em>is</em> the books; below zero it subtracts. A number only counts when its 95% interval
        excludes zero. Sections are never pooled: different sources, model versions and market methods are reported apart.
      </p>
      {sections.map((s) => (
        <Section key={s.title} s={s} />
      ))}
      <OverGapCard rows={overGap} />
      <Card>
        <CardHeader>
          <CardTitle>Return where real payouts exist</CardTitle>
          <CardDescription>
            Settled NFL picks with Underdog&apos;s payout entered, each as a single bet at that payout — the only place a
            return can be computed honestly.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {roi ? (
            <p>
              <span className={cn("font-mono font-medium", roi.roi >= 0 ? "text-success" : "text-danger")}>{pct(roi.roi, 1)}</span> per pick over{" "}
              {roi.n} picks.
            </p>
          ) : (
            <p className="text-muted-foreground">No settled picks with a payout entered yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
