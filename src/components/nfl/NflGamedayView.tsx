"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCcw, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, StatCard } from "@/components/common";
import { PickCard } from "@/components/PickCard";
import { NflFetchButton } from "./NflFetchButton";
import { NflGameCard } from "./NflGameCard";
import { NflSlipsPanel } from "./NflSlipsPanel";
import { UnderdogLineTable } from "./UnderdogLineTable";
import { RbOutAlerts } from "./RbOutAlerts";
import { CaptureClosingLinesButton } from "@/components/CaptureClosingLinesButton";
import { generateNflPicksAction, refreshNflContextAction } from "@/server/actions/nfl";
import { formatSlate } from "@/lib/utils/dates";
import type { NflGamedayData } from "@/lib/nfl/gameday";

/** How long before kickoff the closing-line prompt appears. */
const CAPTURE_WINDOW_MINUTES = 180;

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
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        kicker={`NFL${data.week != null ? ` · Week ${data.week}` : ""} · ${formatSlate(data.date)}`}
        title="NFL Gameday"
        meta={data.isToday ? <Badge>Today</Badge> : undefined}
        actions={
          <nav aria-label="Slates" className="flex flex-wrap items-center gap-1">
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
          </nav>
        }
      />

      {/* The slate in numbers, as a ruled stat line */}
      <section aria-label="Slate summary" className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        <StatCard label={data.games.length === 1 ? "game on the slate" : "games on the slate"} value={data.games.length} />
        <StatCard label={data.pickCount === 1 ? "pick on the board" : "picks on the board"} value={data.pickCount} />
        <StatCard label={data.pendingPropCount === 1 ? "prop stored" : "props stored"} value={data.pendingPropCount} />
        <StatCard label="Odds API credits left" value={data.credits ? data.credits.remaining : "—"} />
      </section>

      <RbOutAlerts alerts={data.rbOutAlerts} />

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

      {/* Credits are charged per market per game, so a market the platform never
          posts is a standing cost with no possible return. */}
      {data.marketsToDrop.length > 0 && (
        <Note tone="warning">
          {data.marketsToDrop.join(" and ")} {data.marketsToDrop.length === 1 ? "has" : "have"} never
          once been seen on Underdog across the props you checked, yet {data.marketsToDrop.length === 1 ? "it is" : "they are"}{" "}
          still fetched every slate — about {data.marketsToDrop.length * Math.max(data.games.length, 1)} credit
          {data.marketsToDrop.length * Math.max(data.games.length, 1) === 1 ? "" : "s"} on this one. Untick{" "}
          {data.marketsToDrop.length === 1 ? "it" : "them"} in Settings → NFL gameday to stop paying for{" "}
          {data.marketsToDrop.length === 1 ? "it" : "them"}.
        </Note>
      )}

      {/* Closing-line value only exists if the closing line gets recorded, and
          the window for that is the hour or two before kickoff. Surface it here
          rather than expecting a trip to Analytics at exactly the right time. */}
      {data.awaitingClosingLines > 0 &&
        data.minutesToKickoff != null &&
        data.minutesToKickoff <= CAPTURE_WINDOW_MINUTES && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3">
            <p className="text-sm text-foreground/90">
              Kickoff in {data.minutesToKickoff} min. Capture closing lines now to score{" "}
              {data.awaitingClosingLines} pick{data.awaitingClosingLines === 1 ? "" : "s"} against where
              the market finished. That is the fastest read on whether these picks were good, and it
              does not wait for results.
            </p>
            <CaptureClosingLinesButton />
          </div>
        )}

      {data.games.length === 0 ? (
        <EmptyState
          icon={<Target className="h-8 w-8" />}
          title="No NFL games on this date"
          description="Use Next slate to jump to the next game day. The schedule comes from ESPN and costs nothing."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            {s.profile === "distribution" && data.pickCount > 0 && (
              <Note>
                This board is a <strong className="font-medium">shortlist to check on Underdog</strong>, not a list
                of bets. It favours the props Underdog tends to price most fairly — usually near 50/50 — and mixes
                prop types. Enter each line and payout below: a pick is worth playing only when{" "}
                <strong className="font-medium">Books</strong> turns green, and that mostly happens when Underdog&apos;s
                line is softer than the books&apos;.
              </Note>
            )}
            <UnderdogLineTable picks={allPicks.filter((p) => p.status === "pending")} />
            {data.contextsCached < data.games.length && (
              <Note>
                Game context (injury reports, spread/total, kickoff weather) is loaded for {data.contextsCached} of{" "}
                {data.games.length} games. Click <em>Load game context</em> to fetch the rest — free.
              </Note>
            )}
            {data.games.map((g) => (
              <NflGameCard key={g.game.eventId} entry={g} profile={s.profile} date={data.date} />
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
