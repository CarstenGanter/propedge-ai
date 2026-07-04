"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setUnderdogLine } from "@/server/actions/picks";
import { formatSignedNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export function UnderdogEdgeBadge({ edge, className }: { edge: number | null; className?: string }) {
  if (edge == null) return null;
  const variant = edge >= 0.4 ? "success" : edge <= -0.4 ? "danger" : "muted";
  const label = edge >= 0.4 ? "soft" : edge <= -0.4 ? "sharp" : "in line";
  return (
    <Badge variant={variant} className={cn("font-mono", className)}>
      UD edge {formatSignedNumber(edge)} · {label}
    </Badge>
  );
}

export function UnderdogLineInput({
  pickId,
  underdogLine,
  marketLine,
  edge,
  compact = false,
}: {
  pickId: string;
  underdogLine: number | null;
  marketLine: number | null;
  edge: number | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState(underdogLine != null ? String(underdogLine) : "");
  const [pending, startTransition] = React.useTransition();
  const [saved, setSaved] = React.useState(false);

  function save() {
    const parsed = value.trim() === "" ? null : Number(value);
    if (parsed != null && Number.isNaN(parsed)) return;
    startTransition(async () => {
      await setUnderdogLine(pickId, parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
      router.refresh();
    });
  }

  return (
    <div className={cn("flex items-center gap-2", compact && "text-xs")}>
      <span className="text-muted-foreground whitespace-nowrap">Underdog line</span>
      <Input
        type="number"
        step="0.5"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder={marketLine != null ? String(marketLine) : "line"}
        className={cn("h-8 w-20", compact && "h-7 w-16 text-xs")}
      />
      <Button size="sm" variant="secondary" onClick={save} disabled={pending} className={cn(compact && "h-7 px-2 text-xs")}>
        {saved ? <Check className="h-3.5 w-3.5" /> : pending ? "…" : "Set"}
      </Button>
      <UnderdogEdgeBadge edge={edge} />
    </div>
  );
}
