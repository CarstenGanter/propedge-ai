"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SportFilter } from "@/components/SportFilter";
import { PickCard } from "@/components/PickCard";
import { EmptyState, SectionHeading } from "@/components/common";
import { generateTodaysPicks } from "@/server/actions/picks";
import { DailyRefreshButton } from "@/components/DailyRefreshButton";
import { SPORTS } from "@/types";
import { formatSlate } from "@/lib/utils/dates";
import type { SerializedPick } from "@/lib/dto";

export function PicksView({
  picks,
  date,
  availablePropCount,
}: {
  picks: SerializedPick[];
  date: string;
  availablePropCount: number;
}) {
  const router = useRouter();
  const [sport, setSport] = React.useState("All");
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);

  const filtered = sport === "All" ? picks : picks.filter((p) => p.prop.sport === sport);
  const activeSports = [...new Set(picks.map((p) => p.prop.sport))].filter((s) =>
    (SPORTS as readonly string[]).includes(s),
  );

  function handleGenerate() {
    setMessage(null);
    startTransition(async () => {
      const summary = await generateTodaysPicks(date);
      const filteredNote = summary.filtered.length
        ? ` Filtered: ${summary.filtered.map((f) => `${f.count} ${f.reason}`).join(", ")}.`
        : "";
      setMessage(
        summary.created > 0
          ? `Generated ${summary.created} ranked pick(s) from ${summary.evaluated} available props.${filteredNote}`
          : `No picks met the criteria from ${summary.evaluated} props.${filteredNote}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Today's Picks"
        description={`Ranked by model confidence for ${formatSlate(date)}. All picks carry risk.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DailyRefreshButton />
            <Button onClick={handleGenerate} disabled={pending}>
              <Sparkles className="h-4 w-4" />
              {pending ? "Analyzing…" : "Generate Today's Picks"}
            </Button>
          </div>
        }
      />

      {message && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-2 text-sm text-foreground/90">
          {message}
        </div>
      )}

      {picks.length > 0 && (
        <SportFilter sports={activeSports} value={sport} onChange={setSport} />
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Target className="h-8 w-8" />}
          title={picks.length === 0 ? "No picks generated yet" : "No picks for this sport"}
          description={
            picks.length === 0
              ? availablePropCount > 0
                ? `You have ${availablePropCount} available prop(s) for this date. Click "Generate Today's Picks" to analyze and rank them.`
                : "Import props (CSV or manual entry) in the Research Lab, or load demo data in Settings, then generate picks."
              : "Try a different sport filter."
          }
          action={
            picks.length === 0 && availablePropCount > 0 ? (
              <Button onClick={handleGenerate} disabled={pending}>
                <Sparkles className="h-4 w-4" />
                Generate now
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((pick, i) => (
            <PickCard key={pick.id} pick={pick} defaultOpen={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
