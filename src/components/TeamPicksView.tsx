"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SportFilter } from "@/components/SportFilter";
import { TeamPickCard } from "@/components/TeamPickCard";
import { EmptyState, SectionHeading } from "@/components/common";
import { generateTeamPicks } from "@/server/actions/teams";
import { formatSlate } from "@/lib/utils/dates";
import { LEAGUE_LABELS, type League } from "@/lib/teamLeagues";
import type { SerializedTeamPick } from "@/lib/dto";

export function TeamPicksView({
  picks,
  date,
  oddsConfigured,
}: {
  picks: SerializedTeamPick[];
  date: string;
  oddsConfigured: boolean;
}) {
  const router = useRouter();
  const [league, setLeague] = React.useState("All");
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);

  const activeLeagues = [...new Set(picks.map((p) => p.league))];
  const filtered = league === "All" ? picks : picks.filter((p) => p.league === league);
  // SportFilter shows league labels but we key on league codes.
  const labelFor = (code: string) => LEAGUE_LABELS[code as League] ?? code;

  function handleGenerate() {
    setMessage(null);
    startTransition(async () => {
      const s = await generateTeamPicks(date);
      const leagues = s.byLeague
        .map((b) => `${b.league}: ${b.created}${b.error ? ` (${b.error})` : ""}`)
        .join(" · ");
      setMessage(
        s.created > 0
          ? `Generated ${s.created} team pick(s). ${leagues}. ${s.creditsRemaining ?? "?"} credits left.`
          : `No team picks generated. ${leagues || "Enable in-season leagues in Settings."}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Team Picks"
        description={`Best teams to win for ${formatSlate(date)} — model win probability vs the market, with value flagged. All picks carry risk.`}
        action={
          <Button onClick={handleGenerate} disabled={pending}>
            <Sparkles className="h-4 w-4" />
            {pending ? "Analyzing games…" : "Fetch + generate"}
          </Button>
        }
      />

      {!oddsConfigured && (
        <div className="rounded-lg border border-warning/25 bg-warning/5 px-4 py-2 text-sm text-warning">
          No <code>ODDS_API_KEY</code> detected — team picks need it for moneylines. Add it to{" "}
          <code>.env</code> and restart.
        </div>
      )}

      {message && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-2 text-sm text-foreground/90">
          {message}
        </div>
      )}

      {picks.length > 0 && (
        <SportFilter
          sports={activeLeagues.map(labelFor)}
          value={league === "All" ? "All" : labelFor(league)}
          onChange={(v) => setLeague(v === "All" ? "All" : activeLeagues.find((c) => labelFor(c) === v) ?? "All")}
        />
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-8 w-8" />}
          title={picks.length === 0 ? "No team picks yet" : "No picks for this league"}
          description={
            picks.length === 0
              ? "Enable in-season leagues in Settings (MLB, WNBA, active soccer), then click Fetch + generate to pull today's games and rank the best teams to win."
              : "Try a different league filter."
          }
          action={
            picks.length === 0 && oddsConfigured ? (
              <Button onClick={handleGenerate} disabled={pending}>
                <Sparkles className="h-4 w-4" /> Generate now
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((p, i) => (
            <TeamPickCard key={p.id} pick={p} defaultOpen={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
