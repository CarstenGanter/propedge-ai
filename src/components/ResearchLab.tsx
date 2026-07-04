"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { EvidenceList } from "@/components/EvidenceList";
import { ConfidenceBadge, RiskBadge, SportBadge, StatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/common";
import { analyzePropById } from "@/server/actions/research";
import { deletePropAction } from "@/server/actions/props";
import type { SerializedProp } from "@/lib/dto";
import type { PickAnalysis } from "@/types";

export function ResearchLab({ props }: { props: SerializedProp[] }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<SerializedProp | null>(null);
  const [analysis, setAnalysis] = React.useState<PickAnalysis | null>(null);
  const [pending, startTransition] = React.useTransition();

  const filtered = props.filter((p) => {
    const q = query.toLowerCase();
    return (
      p.playerName.toLowerCase().includes(q) ||
      p.team.toLowerCase().includes(q) ||
      p.propType.toLowerCase().includes(q) ||
      p.sport.toLowerCase().includes(q)
    );
  });

  function analyze(prop: SerializedProp) {
    setSelected(prop);
    setAnalysis(null);
    startTransition(async () => {
      const res = await analyzePropById(prop.id);
      if (res.ok && res.analysis) setAnalysis(res.analysis);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deletePropAction(id);
      if (selected?.id === id) {
        setSelected(null);
        setAnalysis(null);
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Prop library ({props.length})</CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search player, team, prop type…"
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent className="max-h-[520px] space-y-2 overflow-y-auto">
          {filtered.length === 0 ? (
            <EmptyState title="No props" description="Import a CSV or add a prop above." />
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <SportBadge sport={p.sport} />
                    <span className="truncate text-sm font-medium">{p.playerName}</span>
                    {p.status !== "pending" && <StatusBadge status={p.status} />}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.direction} {p.line} {p.propType} · {p.team} vs {p.opponent}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="secondary" onClick={() => analyze(p)} disabled={pending}>
                    <Sparkles className="h-3.5 w-3.5" /> Analyze
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(p.id)} disabled={pending}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Analysis {selected && `· ${selected.playerName}`}</CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <EmptyState
              title="Select a prop to analyze"
              description="Run the scoring engine on any prop to preview confidence, evidence, and risk before generating picks."
            />
          ) : pending && !analysis ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Analyzing…</p>
          ) : analysis ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <ConfidenceBadge score={analysis.confidenceScore} />
                <RiskBadge risk={analysis.riskLevel} />
                <span className="text-xs text-muted-foreground">
                  edge {analysis.edgeScore > 0 ? "+" : ""}
                  {analysis.edgeScore} · {Math.round(analysis.dataCompleteness * 100)}% data
                </span>
              </div>
              <p className="text-sm text-foreground/90">{analysis.reasoningSummary}</p>
              <ScoreBreakdown breakdown={analysis.scoreBreakdown} />
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Evidence
                </h4>
                <EvidenceList evidence={analysis.evidence} />
              </div>
              {analysis.warnings.length > 0 && (
                <div className="space-y-1 rounded-lg border border-warning/25 bg-warning/5 p-2 text-xs text-warning">
                  {analysis.warnings.map((w, i) => (
                    <p key={i}>⚠ {w}</p>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
