"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addManualProp } from "@/server/actions/props";
import { PROP_TYPES, SPORTS, type Sport } from "@/types";
import { todaySlate } from "@/lib/utils/dates";

export function ManualPropForm() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [sport, setSport] = React.useState<Sport>("NBA");
  const [direction, setDirection] = React.useState("OVER");
  const [propType, setPropType] = React.useState(PROP_TYPES.NBA[0]);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  function onSport(v: string) {
    setSport(v as Sport);
    setPropType(PROP_TYPES[v as Sport]?.[0] ?? "");
  }

  function submit(formData: FormData) {
    const input: Record<string, string> = {
      sport,
      league: String(formData.get("league") || sport),
      gameDate: String(formData.get("gameDate") || todaySlate()),
      playerName: String(formData.get("playerName") || ""),
      team: String(formData.get("team") || ""),
      opponent: String(formData.get("opponent") || ""),
      propType,
      line: String(formData.get("line") || ""),
      overUnder: direction,
      startTime: String(formData.get("startTime") || ""),
      projection: String(formData.get("projection") || ""),
      payoutMultiplier: String(formData.get("payoutMultiplier") || ""),
      injuryStatus: String(formData.get("injuryStatus") || ""),
      notes: String(formData.get("notes") || ""),
    };
    startTransition(async () => {
      const res = await addManualProp(input);
      if (res.ok) {
        setMsg({ ok: true, text: "Prop added." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.errors[0]?.message ?? "Could not add prop." });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusCircle className="h-4 w-4 text-primary" /> Add a prop manually
        </CardTitle>
        <CardDescription>Enter a single Underdog player prop.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Sport</Label>
            <Select value={sport} onValueChange={onSport}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPORTS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>League</Label>
            <Input name="league" defaultValue={sport} />
          </div>
          <div className="space-y-1">
            <Label>Game date</Label>
            <Input name="gameDate" type="date" defaultValue={todaySlate()} />
          </div>
          <div className="space-y-1 col-span-2 sm:col-span-1">
            <Label>Player name</Label>
            <Input name="playerName" placeholder="Jalen Brunson" required />
          </div>
          <div className="space-y-1">
            <Label>Team</Label>
            <Input name="team" placeholder="Knicks" required />
          </div>
          <div className="space-y-1">
            <Label>Opponent</Label>
            <Input name="opponent" placeholder="Celtics" required />
          </div>
          <div className="space-y-1">
            <Label>Prop type</Label>
            <Select value={propType} onValueChange={setPropType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(PROP_TYPES[sport] ?? []).map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Line</Label>
            <Input name="line" type="number" step="0.5" placeholder="25.5" required />
          </div>
          <div className="space-y-1">
            <Label>Direction</Label>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OVER">OVER</SelectItem>
                <SelectItem value="UNDER">UNDER</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Projection (opt)</Label>
            <Input name="projection" type="number" step="0.1" placeholder="27.1" />
          </div>
          <div className="space-y-1">
            <Label>Payout mult. (opt)</Label>
            <Input name="payoutMultiplier" type="number" step="0.1" placeholder="e.g. 1.5" />
          </div>
          <div className="space-y-1">
            <Label>Injury status (opt)</Label>
            <Input name="injuryStatus" placeholder="active / questionable" />
          </div>
          <div className="col-span-2 flex items-end justify-between gap-3 sm:col-span-3">
            {msg ? (
              <p className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add prop"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
