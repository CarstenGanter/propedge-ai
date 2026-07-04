"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, FlaskConical, Loader2, Trash2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  clearAllDataAction,
  clearDemoDataAction,
  loadDemoDataAction,
  updateSettingsAction,
  addAvoidItem,
  removeAvoidItem,
} from "@/server/actions/settings";
import { SPORTS } from "@/types";
import { TEAM_LEAGUES, LEAGUE_LABELS } from "@/lib/teamLeagues";
import type { AppSettingsData } from "@/lib/settings";
import type { ProviderStatus } from "@/lib/providers/config";
import { cn } from "@/lib/utils/cn";

interface AvoidItem {
  id: string;
  type: string;
  value: string;
  reason: string | null;
}

export function SettingsForm({
  settings,
  providers,
  avoidList,
}: {
  settings: AppSettingsData;
  providers: ProviderStatus[];
  avoidList: AvoidItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({
    defaultStake: String(settings.defaultStake),
    bankrollStartingAmount: String(settings.bankrollStartingAmount),
    minConfidenceThreshold: String(settings.minConfidenceThreshold),
    maxDailyPicks: String(settings.maxDailyPicks),
  });
  const [sports, setSports] = React.useState<string[]>(settings.sportsEnabled);
  const [leagues, setLeagues] = React.useState<string[]>(settings.leaguesEnabled);
  const [minTeamConf, setMinTeamConf] = React.useState(String(settings.minTeamConfidence));
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  function persist(patch: Partial<AppSettingsData>) {
    startTransition(async () => {
      await updateSettingsAction(patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }

  function saveNumbers() {
    persist({
      defaultStake: Number(form.defaultStake) || 5,
      bankrollStartingAmount: Number(form.bankrollStartingAmount) || 0,
      minConfidenceThreshold: Number(form.minConfidenceThreshold) || 0,
      maxDailyPicks: Number(form.maxDailyPicks) || 10,
      sportsEnabled: sports,
    });
  }

  function toggleSport(s: string) {
    setSports((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function runData(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    startTransition(async () => {
      await fn();
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>Stake & pick preferences</CardTitle>
          <CardDescription>Default stake starts at $5. Bankroll is simulated unless you mark entries as actually placed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Default stake ($)"><Input type="number" step="0.5" value={form.defaultStake} onChange={(e) => setForm({ ...form, defaultStake: e.target.value })} /></Field>
            <Field label="Starting bankroll ($)"><Input type="number" step="1" value={form.bankrollStartingAmount} onChange={(e) => setForm({ ...form, bankrollStartingAmount: e.target.value })} /></Field>
            <Field label="Min confidence"><Input type="number" step="1" value={form.minConfidenceThreshold} onChange={(e) => setForm({ ...form, minConfidenceThreshold: e.target.value })} /></Field>
            <Field label="Max daily picks"><Input type="number" step="1" value={form.maxDailyPicks} onChange={(e) => setForm({ ...form, maxDailyPicks: e.target.value })} /></Field>
          </div>
          <div>
            <Label>Enabled sports</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SPORTS.map((s) => (
                <button
                  key={s}
                  onClick={() => toggleSport(s)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    sports.includes(s)
                      ? "border-primary/40 bg-primary/12 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveNumbers} disabled={pending}>
              {pending ? "Saving…" : "Save preferences"}
            </Button>
            {saved && <span className="text-sm text-success">Saved</span>}
          </div>
        </CardContent>
      </Card>

      {/* Team picks */}
      <Card>
        <CardHeader>
          <CardTitle>Team picks (game winners)</CardTitle>
          <CardDescription>
            Enabled leagues for moneyline recommendations. Keep only in-season leagues on — each
            costs ~1 Odds API credit per fetch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {TEAM_LEAGUES.map((l) => (
              <button
                key={l}
                onClick={() => setLeagues((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]))}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  leagues.includes(l)
                    ? "border-primary/40 bg-primary/12 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground",
                )}
              >
                {LEAGUE_LABELS[l]}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-3">
            <Field label="Min team confidence">
              <Input type="number" step="1" value={minTeamConf} onChange={(e) => setMinTeamConf(e.target.value)} className="w-28" />
            </Field>
            <Button
              onClick={() => persist({ leaguesEnabled: leagues, minTeamConfidence: Number(minTeamConf) || 50 })}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save team settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Scoring model */}
      <Card>
        <CardHeader>
          <CardTitle>Scoring model</CardTitle>
          <CardDescription>
            Choose how confidence is calculated. Use “Market model” when The Odds API is your main
            source (confidence is driven by de-vigged market probability). Use “Balanced” when you
            also have player stats/projections.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {([
              ["balanced", "Balanced (stats + market)"],
              ["market", "Market model (The Odds API)"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => persist({ scoringProfile: value })}
                disabled={pending}
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  settings.scoringProfile === value
                    ? "border-primary/50 bg-primary/12 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data sources */}
      <Card>
        <CardHeader>
          <CardTitle>Data sources</CardTitle>
          <CardDescription>Demo mode uses clearly-labeled synthetic data. Live research uses free public endpoints (ESPN) when enabled.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="Demo mode"
            description="Analyze props with deterministic demo data (badged everywhere)."
            checked={settings.demoMode}
            onChange={(v) => persist({ demoMode: v })}
          />
          <ToggleRow
            label="Enable live web research"
            description="Allow calls to free public endpoints for box scores & schedules (auto-settlement)."
            checked={settings.enableWebResearch}
            onChange={(v) => persist({ enableWebResearch: v })}
          />
          <div className="space-y-2 pt-2">
            <Label>Provider status</Label>
            {providers.map((p) => (
              <div key={p.key} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.detail}</p>
                </div>
                {p.configured ? (
                  <Badge variant="success"><CheckCircle2 className="h-3 w-3" /> Active</Badge>
                ) : (
                  <Badge variant="muted"><XCircle className="h-3 w-3" /> Off</Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data management */}
      <Card>
        <CardHeader>
          <CardTitle>Data management</CardTitle>
          <CardDescription>Load demo data to explore the app, or export your data to CSV.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => runData("load", loadDemoDataAction)} disabled={pending}>
              {busy === "load" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              Load demo data
            </Button>
            <Button variant="ghost" onClick={() => runData("cleardemo", clearDemoDataAction)} disabled={pending}>
              Clear demo data
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm("Delete ALL props, picks, parlays and bankroll history? This cannot be undone.")) {
                  runData("clearall", clearAllDataAction);
                }
              }}
              disabled={pending}
            >
              <Trash2 className="h-4 w-4" /> Clear all data
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["picks", "results", "props", "bankroll"] as const).map((t) => (
              <Button key={t} asChild variant="outline" size="sm">
                <a href={`/api/export?type=${t}`} download>
                  <Download className="h-3.5 w-3.5" /> Export {t}
                </a>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Avoid list */}
      <AvoidListManager avoidList={avoidList} pending={pending} onChange={() => router.refresh()} startTransition={startTransition} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function AvoidListManager({
  avoidList,
  pending,
  onChange,
  startTransition,
}: {
  avoidList: AvoidItem[];
  pending: boolean;
  onChange: () => void;
  startTransition: React.TransitionStartFunction;
}) {
  const [type, setType] = React.useState<"player" | "propType">("player");
  const [value, setValue] = React.useState("");

  function add() {
    if (!value.trim()) return;
    startTransition(async () => {
      await addAvoidItem({ type, value });
      setValue("");
      onChange();
    });
  }
  function remove(id: string) {
    startTransition(async () => {
      await removeAvoidItem(id);
      onChange();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Avoid list</CardTitle>
        <CardDescription>Players or prop types you want to steer clear of.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "player" | "propType")}
            className="h-10 rounded-md border border-border bg-input/60 px-2 text-sm"
          >
            <option value="player">Player</option>
            <option value="propType">Prop type</option>
          </select>
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Player name" className="max-w-xs" />
          <Button onClick={add} disabled={pending || !value.trim()}>Add</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {avoidList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing on your avoid list.</p>
          ) : (
            avoidList.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs">
                <span className="text-muted-foreground">{a.type}:</span> {a.value}
                <button onClick={() => remove(a.id)} className="text-muted-foreground hover:text-danger">
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              </span>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
