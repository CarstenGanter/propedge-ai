import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus } from "lucide-react";
import type { EvidenceItem } from "@/types";
import { cn } from "@/lib/utils/cn";

function ImpactIcon({ impact }: { impact: number }) {
  if (impact > 1) return <ArrowUpRight className="h-4 w-4 text-success" />;
  if (impact < -1) return <ArrowDownRight className="h-4 w-4 text-danger" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

export function EvidenceList({ evidence }: { evidence: EvidenceItem[] }) {
  if (evidence.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No evidence recorded. Confidence reduced due to missing sources — manual review recommended.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {evidence.map((e, i) => (
        <li key={i} className="flex gap-3">
          <div className="mt-0.5">
            <ImpactIcon impact={e.confidenceImpact} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{e.title}</p>
            </div>
            <p className="text-sm text-muted-foreground">{e.summary}</p>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/80">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5",
                  e.sourceName.toLowerCase().includes("demo")
                    ? "bg-warning/10 text-warning"
                    : "bg-muted/60",
                )}
              >
                {e.sourceName}
              </span>
              {e.sourceUrl && (
                <a
                  href={e.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
