"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CloudDownload, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchPropsFromOddsApi } from "@/server/actions/odds";
import { SPORTS, type Sport } from "@/types";

type OddsImportResult = Awaited<ReturnType<typeof fetchPropsFromOddsApi>>;

export function OddsFetch({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [sport, setSport] = React.useState<Sport>("MLB");
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<OddsImportResult | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      const res = await fetchPropsFromOddsApi(sport);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudDownload className="h-4 w-4 text-primary" /> Fetch from The Odds API
          {result?.creditsRemaining != null && (
            <Badge variant="muted" className="ml-auto">
              <Zap className="h-3 w-3" /> {result.creditsRemaining} credits left
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Pulls de-vigged sportsbook player props for the selected sport. Each fetch uses a few API
          credits, so pull one sport at a time. Off-season sports return nothing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!configured ? (
          <p className="rounded-lg border border-warning/25 bg-warning/5 p-2 text-xs text-warning">
            No <code>ODDS_API_KEY</code> detected. Add it to <code>.env</code> and restart the dev
            server to enable live fetching.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Select value={sport} onValueChange={(v) => setSport(v as Sport)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SPORTS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={run} disabled={pending}>
              <CloudDownload className="h-4 w-4" />
              {pending ? "Fetching…" : `Fetch ${sport} props`}
            </Button>
          </div>
        )}

        {result && (
          <div className="text-sm">
            {result.ok ? (
              <p className="text-success">
                Imported {result.imported} {result.sport} props from {result.events} game(s).
                Head to Today's Picks and hit Generate.
              </p>
            ) : (
              <p className="text-danger">{result.error}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
