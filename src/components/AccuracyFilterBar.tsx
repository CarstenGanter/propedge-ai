"use client";

import Link from "next/link";
import { segmentClass, segmentGroupClass } from "@/components/ui/segmented";
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
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="kicker">Show</span>
        <div className={segmentGroupClass}>
          <Pill href={href({ scope: "all" })} active={scope === "all"}>
            Every model pick <span className="tabular-nums text-faint">{allCount}</span>
          </Pill>
          <Pill href={href({ scope: "mine" })} active={scope === "mine"}>
            Only picks I took <span className="tabular-nums text-faint">{mineCount}</span>
          </Pill>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span className="kicker">Sport</span>
        <div className={segmentGroupClass}>
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
    </div>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`${segmentClass(active)} gap-1.5`}
    >
      {children}
    </Link>
  );
}
