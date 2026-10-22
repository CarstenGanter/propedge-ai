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
  // On a phone the nav row scrolls; keep the current page in view.
  const activeRef = React.useRef<HTMLAnchorElement>(null);
  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
  return (
    <nav aria-label="Main" className="no-scrollbar min-w-0 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 text-sm">
        {NAV.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                ref={active ? activeRef : undefined}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center rounded-md px-3 font-medium transition-colors duration-150 sm:h-8",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
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
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <p className="hidden text-xs tabular-nums text-muted-foreground md:block" suppressHydrationWarning>
      {today}
    </p>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-foreground"
          >
            <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-md bg-foreground text-2xs font-bold text-background">
              P
            </span>
            PropEdge
          </Link>
          <div className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
          <NavLinks />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Dateline />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <DisclaimerBanner />
        </div>
        {children}
      </main>
    </div>
  );
}
