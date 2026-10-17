import { ShieldAlert } from "lucide-react";

export function DisclaimerBanner() {
  return (
    <div className="flex items-start gap-2.5 border-b border-border pb-3 text-xs leading-relaxed text-muted-foreground">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold text-foreground">PropEdge AI is a research and tracking tool.</span>{" "}
        It does not guarantee outcomes. Sports picks involve risk, and past performance does not
        ensure future results. Confidence scores are model estimates — not financial advice.
      </p>
    </div>
  );
}
