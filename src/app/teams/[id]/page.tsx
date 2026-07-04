import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ThumbsDown, ThumbsUp } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { getTeamPickById } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamScoreBreakdown } from "@/components/TeamScoreBreakdown";
import { EvidenceList } from "@/components/EvidenceList";
import { TeamBetControls, TeamSettlementModal } from "@/components/TeamPickActions";
import {
  ConfidenceBadge,
  DemoDataBadge,
  LeagueBadge,
  RiskBadge,
  TagChip,
  TeamStatusBadge,
  ValueBadge,
} from "@/components/badges";
import { formatGameDateTime } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

export default async function TeamPickDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [pick, settings, betEntry] = await Promise.all([
    getTeamPickById(id),
    getSettings(),
    prisma.bankrollEntry.findFirst({ where: { teamPickId: id, entryType: "moneyline" } }),
  ]);
  if (!pick) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/teams"><ArrowLeft className="h-4 w-4" /> Back to team picks</Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <LeagueBadge league={pick.league} />
            <TeamStatusBadge status={pick.status} />
            {pick.isDemo && <DemoDataBadge />}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {pick.recommendedTeam} <span className="text-base font-normal text-muted-foreground">to win</span>
          </h1>
          <p className="text-muted-foreground">
            {pick.awayTeam} @ {pick.homeTeam} · {formatGameDateTime(pick.gameStartTime, pick.date)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {pick.tags.map((t) => (
              <TagChip key={t} tag={t} />
            ))}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConfidenceBadge score={pick.confidenceScore} className="text-sm" />
          <RiskBadge risk={pick.riskLevel} />
          <ValueBadge edge={pick.valueEdge} />
          <p className="text-xs text-muted-foreground">
            Model <span className="font-mono text-foreground">{Math.round(pick.winProbability * 100)}%</span> · Market{" "}
            <span className="font-mono text-foreground">{Math.round(pick.marketWinProb * 100)}%</span>
            {pick.priceAmerican != null && (
              <> · <span className="font-mono text-foreground">{pick.priceAmerican > 0 ? "+" : ""}{pick.priceAmerican}</span></>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Verdict</CardTitle></CardHeader>
            <CardContent><p className="text-sm leading-relaxed text-foreground/90">{pick.verdict}</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Deep-dive analysis</CardTitle></CardHeader>
            <CardContent><p className="text-sm leading-relaxed text-muted-foreground">{pick.deepDiveAnalysis}</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Score breakdown</CardTitle></CardHeader>
            <CardContent><TeamScoreBreakdown breakdown={pick.scoreBreakdown} /></CardContent>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-success"><ThumbsUp className="h-4 w-4" /> Reasons for</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {pick.reasonsFor.length ? pick.reasonsFor.map((r, i) => <li key={i}>• {r}</li>) : <li>• Market/form balance.</li>}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-danger"><ThumbsDown className="h-4 w-4" /> Reasons against</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {pick.reasonsAgainst.length ? pick.reasonsAgainst.map((r, i) => <li key={i}>• {r}</li>) : <li>• Single-game upset variance.</li>}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <TeamBetControls
                pick={pick}
                defaultStake={settings.defaultStake}
                hasBet={Boolean(betEntry)}
                placedReal={betEntry?.placedReal ?? false}
              />
              <div className="flex items-center gap-2">
                <TeamSettlementModal pick={pick} />
                <span className="text-xs text-muted-foreground">Mark win/loss/push</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Evidence & sources</CardTitle></CardHeader>
            <CardContent>
              <EvidenceList evidence={pick.evidence} />
              {pick.warnings.length > 0 && (
                <div className="mt-3 space-y-1 rounded-lg border border-warning/25 bg-warning/5 p-2 text-xs text-warning">
                  {pick.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Meta</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>Model version</span><span className="font-mono text-foreground">{pick.modelVersion}</span></div>
              <div className="flex justify-between"><span>Rank</span><span className="text-foreground">#{pick.rank}</span></div>
              <div className="flex justify-between"><span>Data</span><span className="text-foreground">{pick.isDemo ? "Demo" : "Live"}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
