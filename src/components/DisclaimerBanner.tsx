import { ShieldAlert } from "lucide-react";

export function DisclaimerBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning/5 px-4 py-2.5 text-xs text-muted-foreground">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <p>
        <span className="font-semibold text-foreground/90">PropEdge AI is a research and tracking tool.</span>{" "}
        It does not guarantee outcomes. Sports picks involve risk, and past performance does not
        ensure future results. Confidence scores are model estimates — not financial advice.
      </p>
    </div>
  );
}
