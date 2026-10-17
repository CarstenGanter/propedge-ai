"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/picks", label: "Today's Picks" },
  { href: "/nfl", label: "NFL Gameday" },
  { href: "/teams", label: "Team Picks" },
  { href: "/research", label: "Research Lab" },
  { href: "/parlays", label: "Parlay Builder" },
  { href: "/results", label: "Results" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];

function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-x-6 text-sm font-medium sm:min-w-0 sm:flex-wrap">
        {NAV.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Today's date as a dateline. Server and browser share a clock here, but the text is allowed to differ at midnight. */
function Dateline() {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <p className="font-mono text-xs text-muted-foreground" suppressHydrationWarning>
      {today}
    </p>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
        <div className="border-b-[3px] border-border-strong">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <Link href="/" className="font-serif text-[32px] font-medium italic leading-none tracking-tight text-foreground">
              PropEdge
            </Link>
            <div className="flex items-center gap-3">
              <Dateline />
              <ThemeToggle />
            </div>
          </div>
          <div className="mt-2">
            <NavLinks />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <DisclaimerBanner />
        </div>
        {children}
      </main>
    </div>
  );
}
