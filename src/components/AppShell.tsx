"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  FlaskConical,
  LayoutDashboard,
  Layers,
  ListChecks,
  Menu,
  Settings,
  Target,
  Trophy,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/picks", label: "Today's Picks", icon: Target },
  { href: "/teams", label: "Team Picks", icon: Trophy },
  { href: "/research", label: "Research Lab", icon: FlaskConical },
  { href: "/parlays", label: "Parlay Builder", icon: Layers },
  { href: "/results", label: "Results", icon: ListChecks },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary shadow-lg shadow-primary/30">
        <Target className="h-5 w-5 text-primary-foreground" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold gradient-text">PropEdge AI</p>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Prop Research
        </p>
      </div>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border/60 bg-surface/40 px-4 py-6 backdrop-blur-xl lg:flex">
        <Brand />
        <div className="mt-8 flex-1">
          <NavLinks />
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground/70">
          Not financial advice. Sports outcomes are uncertain.
        </p>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-card px-4 py-6">
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} className="text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-8 flex-1">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button onClick={() => setOpen(true)} className="text-foreground">
            <Menu className="h-5 w-5" />
          </button>
          <Brand />
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-5">
            <DisclaimerBanner />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
