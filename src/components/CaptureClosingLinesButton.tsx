"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { captureClosingLinesAction } from "@/server/actions/lines";

/**
 * Capture closing lines for today's pending picks. Team lines are cheap (bulk
 * h2h); "+ props" also re-fetches player props, which costs Odds API credits.
 */
export function CaptureClosingLinesButton() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  function run(includeProps: boolean) {
    setMsg(null);
    startTransition(async () => {
      const res = await captureClosingLinesAction(includeProps);
      setMsg(res.message);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => run(false)} disabled={pending}>
          <Clock className="mr-1.5 h-3.5 w-3.5" />
          {pending ? "Capturing…" : "Capture closing lines"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => run(true)} disabled={pending} title="Also re-fetches player props (uses Odds API credits)">
          + props
        </Button>
      </div>
      {msg && <p className="max-w-xs text-right text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
