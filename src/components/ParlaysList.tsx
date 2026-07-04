"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DemoDataBadge } from "@/components/badges";
import { EmptyState } from "@/components/common";
import { deleteParlayAction, voidParlay } from "@/server/actions/parlays";
import { formatCurrency, formatSignedCurrency } from "@/lib/utils/format";
import type { SerializedParlay } from "@/lib/dto";

const STATUS_VARIANT: Record<string, "muted" | "success" | "danger" | "warning"> = {
  pending: "muted",
  won: "success",
  lost: "danger",
  void: "warning",
  push: "warning",
};

export function ParlaysList({ parlays }: { parlays: SerializedParlay[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function act(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  if (parlays.length === 0) {
    return <EmptyState title="No parlays yet" description="Select 2+ legs above and save your first parlay." />;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {parlays.map((p) => (
        <Card key={p.id}>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                {p.name}
                {p.isDemo && <DemoDataBadge />}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {p.date} · {p.legs.length} legs · {p.stake ? formatCurrency(p.stake) : "$0"} @ {p.payoutMultiplier}x
              </p>
            </div>
            <Badge variant={STATUS_VARIANT[p.status] ?? "muted"}>{p.status}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="space-y-1 text-xs text-muted-foreground">
              {p.legs.map((leg) => (
                <li key={leg.id} className="flex items-center justify-between">
                  <span>
                    {leg.playerName} · {leg.direction} {leg.line} {leg.propType}
                  </span>
                  <span className="capitalize">{leg.status}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-border/60 pt-2 text-sm">
              <span className="text-muted-foreground">
                {p.status === "pending"
                  ? `Projected ${formatCurrency(p.projectedPayout)}`
                  : `P/L`}
              </span>
              <span
                className={
                  p.profitLoss == null
                    ? "text-muted-foreground"
                    : p.profitLoss >= 0
                      ? "text-success"
                      : "text-danger"
                }
              >
                {p.profitLoss == null ? "pending" : formatSignedCurrency(p.profitLoss)}
              </span>
            </div>
            <div className="flex justify-end gap-1">
              {p.status === "pending" && (
                <Button size="sm" variant="ghost" onClick={() => act(() => voidParlay(p.id))} disabled={pending}>
                  Void
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => act(() => deleteParlayAction(p.id))} disabled={pending}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
