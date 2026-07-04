"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { settleDailyPicks } from "@/server/actions/results";

export function SettleAllButton({ date }: { date: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const res = await settleDailyPicks(date);
      const detail =
        res.unresolved > 0
          ? ` ${res.unresolved} still need manual settlement${res.notes[0] ? ` (e.g. ${res.notes[0].player}: ${res.notes[0].note})` : ""}.`
          : "";
      setMsg(`Auto-settled ${res.settled} pick(s).${detail}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={run} disabled={pending} variant="secondary">
        <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        {pending ? "Settling…" : "Settle picks (auto)"}
      </Button>
      {msg && <p className="max-w-xs text-right text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
