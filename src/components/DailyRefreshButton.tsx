"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runDailyRefreshAction } from "@/server/actions/jobs";

export function DailyRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const s = await runDailyRefreshAction();
      if (!s.ok) {
        setMsg(s.error ?? "Refresh failed.");
        return;
      }
      const imported = s.sports.reduce((n, x) => n + x.imported, 0);
      const created = s.generated.reduce((n, x) => n + x.created, 0);
      setMsg(
        `Fetched ${imported} props, generated ${created} picks.` +
          (s.creditsRemaining != null ? ` ${s.creditsRemaining} credits left.` : ""),
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={run} disabled={pending}>
        <RefreshCcw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        {pending ? "Refreshing…" : "Fetch + generate (all sports)"}
      </Button>
      {msg && <p className="max-w-xs text-right text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
