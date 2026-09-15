"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCcw, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common";
import { PickCard } from "@/components/PickCard";
import { NflFetchButton } from "./NflFetchButton";
import { NflGameCard } from "./NflGameCard";
import { NflSlipsPanel } from "./NflSlipsPanel";
import { UnderdogLineTable } from "./UnderdogLineTable";
import { generateNflPicksAction, refreshNflContextAction } from "@/server/actions/nfl";
import { formatSlate } from "@/lib/utils/dates";
import type { NflGamedayData } from "@/lib/nfl/gameday";

export function NflGamedayView({ data }: { data: NflGamedayData }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [busy, setBusy] = React.useState<"context" | "generate" | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const allPicks = data.games.flatMap((g) => g.picks).concat(data.unmatchedPicks);
  const s = data.settings;

  function loadContext() {
    setBusy("context");
    setMsg(null);
    startTransition(async () => {
      const r = await refreshNflContextAction(data.date);
      const d = r.defense.season;
      setMsg(
        `Loaded ${r.contextsWarmed} game context(s).` +
          (d ? ` Defense data: ${d.gamesKnown} box score(s) on file, ${d.gamesFetched} new.` : "") +
          (r.defense.prior ? ` Prior-season backfill: ${r.defense.prior.gamesFetched} game(s).` : "") +
          " No Odds API credits used.",
      );
      setBusy(null);
      router.refresh();
    });
  }

  function regenerate() {
    setBusy("generate");
    setMsg(null);
    startTransition(async () => {
      const r = await generateNflPicksAction(data.date);
      const filtered = r.filtered.length ? ` Filtered: ${r.filtered.map((f) => `${f.count} ${f.reason}`).join(", ")}.` : "";
      setMsg(`Re-ranked ${r.created} pick(s) from ${r.evaluated} stored prop(s).${filtered} No credits used.`);
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">NFL Gameday</h1>
            {data.week != null && <Badge variant="muted">Week {data.week}</Badge>}
            {data.isToday && <Badge variant="success">Today</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {formatSlate(data.date)} · {data.games.length} game{data.games.length === 1 ? "" : "s"} · {data.pickCount} pick
            {data.pickCount === 1 ? "" : "s"} · {data.pendingPropCount} prop{data.pendingPropCount === 1 ? "" : "s"} stored
            {data.credits && (
              <>
                {" "}
                · <span className="text-foreground/80">{data.credits.remaining} Odds API credits left</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm" disabled={!data.prevDate}>
              <Link href={data.prevDate ? `/nfl?date=${data.prevDate}` : "#"} aria-disabled={!data.prevDate}>
                <ChevronLeft className="h-4 w-4" /> Prev slate
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/nfl">
                <CalendarDays className="h-4 w-4" /> Next up
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" disabled={!data.nextDate}>
              <Link href={data.nextDate ? `/nfl?date=${data.nextDate}` : "#"} aria-disabled={!data.nextDate}>
                Next slate <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <NflFetchButton date={data.date} disabled={data.games.length === 0 || !s.oddsConfigured} />
        <Button variant="secondary" onClick={loadContext} disabled={pending || data.games.length === 0}>
          <RefreshCcw className={busy === "context" && pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {busy === "context" && pending ? "Loading…" : "Load game context (free)"}
        </Button>
        <Button variant="outline" onClick={regenerate} disabled={pending || data.pendingPropCount === 0}>
          <Sparkles className="h-4 w-4" />
          {busy === "generate" && pending ? "Ranking…" : "Re-rank picks (free)"}
        </Button>
      </div>

      {/* Status notes */}
      {!s.nflEnabled && (
        <Note tone="warning">NFL is not in your enabled sports — enable it in Settings or picks will be filtered out.</Note>
      )}
      {s.demoMode && <Note tone="warning">Demo mode is on: research uses labeled synthetic data. Turn it off in Settings for real feeds.</Note>}
      {!s.enableWebResearch && !s.demoMode && (
        <Note tone="warning">Live web research is off — enable it in Settings so gamelogs, injury reports and weather are fetched.</Note>
      )}
      {!s.oddsConfigured && <Note tone="warning">No ODDS_API_KEY in .env — props can only come from CSV/manual entry.</Note>}
      {msg && <Note>{msg}</Note>}

      {data.games.length === 0 ? (
        <EmptyState
          icon={<Target className="h-8 w-8" />}
          title="No NFL games on this date"
          description="Use Next slate to jump to the next game day. The schedule comes from ESPN and costs nothing."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <UnderdogLineTable picks={allPicks.filter((p) => p.status === "pending")} />
            {data.contextsCached < data.games.length && (
              <Note>
                Game context (injury reports, spread/total, kickoff weather) is loaded for {data.contextsCached} of{" "}
                {data.games.length} games. Click <em>Load game context</em> to fetch the rest — free.
              </Note>
            )}
            {data.games.map((g) => (
              <NflGameCard key={g.game.eventId} entry={g} profile={s.profile} />
            ))}
            {data.unmatchedPicks.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Picks not matched to a game</h3>
                {data.unmatchedPicks.map((p) => (
                  <PickCard key={p.id} pick={p} profile={s.profile} />
                ))}
              </div>
            )}
          </div>
          <div className="lg:sticky lg:top-6 lg:self-start">
            <NflSlipsPanel
              picks={allPicks}
              date={data.date}
              defaultStake={s.defaultStake}
              calibrated={s.profile === "distribution"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warning" }) {
  return (
    <div
      className={
        tone === "warning"
          ? "rounded-lg border border-warning/25 bg-warning/5 px-4 py-2 text-sm text-warning"
          : "rounded-lg border border-primary/25 bg-primary/5 px-4 py-2 text-sm text-foreground/90"
      }
    >
      {children}
    </div>
  );
}
