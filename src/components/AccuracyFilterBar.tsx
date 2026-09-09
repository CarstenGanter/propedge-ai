"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { AccuracyScope } from "@/lib/analytics";

/**
 * Scope/sport switcher for the accuracy views. Uses plain links + search params
 * so the page stays a server component and the view is shareable/bookmarkable.
 */
export function AccuracyFilterBar({
  scope,
  sport,
  sports,
  mineCount,
  allCount,
}: {
  scope: AccuracyScope;
  sport: string;
  sports: string[];
  mineCount: number;
  allCount: number;
}) {
  const href = (next: { scope?: AccuracyScope; sport?: string }) => {
    const p = new URLSearchParams();
    const s = next.scope ?? scope;
    const sp = next.sport ?? sport;
    if (s !== "all") p.set("scope", s);
    if (sp !== "All") p.set("sport", sp);
    const q = p.toString();
    return q ? `/analytics?${q}` : "/analytics";
  };

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Show</span>
        <Pill href={href({ scope: "all" })} active={scope === "all"}>
          Every model pick ({allCount})
        </Pill>
        <Pill href={href({ scope: "mine" })} active={scope === "mine"}>
          Only picks I took ({mineCount})
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Sport</span>
        <Pill href={href({ sport: "All" })} active={sport === "All"}>
          All
        </Pill>
        {sports.map((s) => (
          <Pill key={s} href={href({ sport: s })} active={sport === s}>
            {s}
          </Pill>
        ))}
      </div>
    </div>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/12 text-primary"
          : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
