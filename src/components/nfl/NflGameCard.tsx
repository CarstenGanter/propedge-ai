"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Clock, CloudRain, ExternalLink, Home, MapPin, Trophy, Wind } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PickCard } from "@/components/PickCard";
import { formatGameDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { NflGamedayGame } from "@/lib/nfl/gameday";
import type { NflInjuryEntry } from "@/lib/nfl/injuryReport";
import type { ScoringProfile } from "@/types";

function statusVariant(s: NflInjuryEntry["status"]): "danger" | "warning" | "muted" | "success" {
  if (s === "out") return "danger";
  if (s === "doubtful") return "warning";
  if (s === "questionable") return "muted";
  return "success";
}

export function NflGameCard({ entry, profile }: { entry: NflGamedayGame; profile: ScoringProfile }) {
  const { game, context, picks, teamPick } = entry;
  const [showInjuries, setShowInjuries] = React.useState(false);
  const a = context?.assessment;
  const indoor = context?.venue.roof === "dome" || game.indoor === true;
  const injuryCount = context?.injuries.reduce((n, t) => n + t.players.length, 0) ?? 0;

  return (
    <Card className="overflow-hidden animate-in">
      {/* Game header */}
      <div className="flex flex-col gap-3 border-b border-border/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">
              {game.away.name} <span className="text-foreground/50">@</span> {game.home.name}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatGameDateTime(game.kickoffISO)}
                {game.completed && game.home.score != null && game.away.score != null && (
                  <span className="ml-1 text-foreground/80">
                    · Final {game.away.score}–{game.home.score}
                  </span>
                )}
              </span>
              {(context?.venue.name ?? game.venue) && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {context?.venue.name ?? game.venue}
                  {context?.venue.neutralSite && <Badge variant="muted">neutral site</Badge>}
                </span>
              )}
              <a
                href={`https://www.espn.com/nfl/game/_/gameId/${game.eventId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                ESPN <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="muted">
              <Home className="h-3 w-3" /> {indoor ? "Indoor" : context?.venue.roof === "retractable" ? "Retractable roof" : "Outdoor"}
            </Badge>
            {(context?.odds?.details || game.spreadText) && (
              <Badge variant="outline">
                {context?.odds?.details ?? game.spreadText}
                {(context?.odds?.overUnder ?? game.overUnder) != null && ` · O/U ${context?.odds?.overUnder ?? game.overUnder}`}
              </Badge>
            )}
            {teamPick && (
              <Link href={`/teams/${teamPick.id}`}>
                <Badge variant="default">
                  <Trophy className="h-3 w-3" /> Lean {teamPick.recommendedTeam} {Math.round(teamPick.winProbability * 100)}%
                </Badge>
              </Link>
            )}
          </div>
        </div>

        {/* Weather + odds provenance */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {a ? (
            <span className={cn("inline-flex items-start gap-1", a.concern && "text-warning")}>
              {a.concern ? <Wind className="mt-0.5 h-3 w-3 shrink-0" /> : <CloudRain className="mt-0.5 h-3 w-3 shrink-0" />}
              <span>
                {a.note}{" "}
                <span className="rounded bg-muted/60 px-1 py-0.5 text-[10px]">{a.sourceName}</span>
                {a.sourceUrl && (
                  <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="ml-1 text-primary hover:underline">
                    source
                  </a>
                )}
              </span>
            </span>
          ) : game.weatherText ? (
            <span className="inline-flex items-center gap-1">
              <CloudRain className="h-3 w-3" /> {game.weatherText}
              {game.weatherTempF != null && ` · ${game.weatherTempF}°F`}{" "}
              <span className="rounded bg-muted/60 px-1 py-0.5 text-[10px]">ESPN</span>
            </span>
          ) : null}
          {context?.odds?.provider && (context.odds.details || context.odds.overUnder != null) && (
            <span>
              Line via <span className="rounded bg-muted/60 px-1 py-0.5 text-[10px]">{context.odds.provider} · ESPN</span>
            </span>
          )}
        </div>

        {/* Injury report */}
        {context && (
          <div>
            <button
              onClick={() => setShowInjuries((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Game injury report ({injuryCount}) <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showInjuries && "rotate-180")} />
            </button>
            {showInjuries && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {context.injuries.length === 0 && (
                  <p className="text-xs text-muted-foreground">ESPN has not published a report for this game yet.</p>
                )}
                {context.injuries.map((t) => (
                  <div key={t.team} className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    <p className="mb-1.5 text-xs font-semibold">{t.team}</p>
                    {t.players.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No listed players.</p>
                    ) : (
                      <ul className="space-y-1">
                        {t.players.map((p) => (
                          <li key={p.name} className="flex flex-wrap items-center gap-1.5 text-xs">
                            <Badge variant={statusVariant(p.status)}>{p.rawStatus || p.status}</Badge>
                            <span className="font-medium">{p.name}</span>
                            {p.position && <span className="text-muted-foreground">{p.position}</span>}
                            {p.detail && <span className="text-muted-foreground">· {p.detail}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground sm:col-span-2">
                  Source: ESPN game injury report{context.fetchedAt ? `, fetched ${new Date(context.fetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Picks */}
      <div className="space-y-3 p-4">
        {picks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ranked picks for this game yet.</p>
        ) : (
          picks.map((p) => <PickCard key={p.id} pick={p} profile={profile} />)
        )}
      </div>
    </Card>
  );
}
