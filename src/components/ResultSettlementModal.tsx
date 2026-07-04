"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/badges";
import { settlePickManually } from "@/server/actions/results";
import { settleProp } from "@/lib/settlement";
import type { SerializedPick } from "@/lib/dto";
import type { SettlementStatus } from "@/types";

export function ResultSettlementModal({
  pick,
  trigger,
}: {
  pick: SerializedPick;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [actual, setActual] = React.useState(pick.actualResult != null ? String(pick.actualResult) : "");
  const [note, setNote] = React.useState(pick.userNote ?? "");
  const [pending, startTransition] = React.useTransition();

  const parsed = actual.trim() === "" ? null : Number(actual);
  const predicted: SettlementStatus =
    parsed == null || Number.isNaN(parsed)
      ? "pending"
      : settleProp(pick.prop.line, pick.prop.direction, parsed);

  function submit(status?: SettlementStatus) {
    startTransition(async () => {
      await settlePickManually(
        status
          ? { pickId: pick.id, status, actualResult: null, note: note || undefined }
          : { pickId: pick.id, actualResult: parsed, note: note || undefined },
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            Settle
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settle pick</DialogTitle>
          <DialogDescription>
            {pick.prop.playerName} · {pick.prop.direction} {pick.prop.line} {pick.prop.propType}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Actual stat result</Label>
            <Input
              type="number"
              step="0.1"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder={`Line is ${pick.prop.line}`}
              autoFocus
            />
            {parsed != null && !Number.isNaN(parsed) && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                Result: <StatusBadge status={predicted} />
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Foul trouble, blowout, etc." />
          </div>
        </div>

        <DialogFooter>
          <div className="flex flex-1 gap-2">
            <Button variant="ghost" size="sm" onClick={() => submit("push")} disabled={pending}>
              Push
            </Button>
            <Button variant="ghost" size="sm" onClick={() => submit("void")} disabled={pending}>
              Void
            </Button>
          </div>
          <Button onClick={() => submit()} disabled={pending || parsed == null || Number.isNaN(parsed)}>
            {pending ? "Saving…" : "Settle by result"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
