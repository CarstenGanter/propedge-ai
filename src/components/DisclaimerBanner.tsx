import { ShieldAlert } from "lucide-react";

export function DisclaimerBanner() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden="true" />
      <p>
        <span className="font-semibold text-foreground">PropEdge AI is a research and tracking tool.</span>{" "}
        It does not guarantee outcomes. Sports picks involve risk, and past performance does not
        ensure future results. Confidence scores are model estimates — not financial advice.
      </p>
    </div>
  );
}
