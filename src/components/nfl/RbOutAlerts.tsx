import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RbOutAlert } from "@/lib/nfl/rbOutAlert";

const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Running backs ruled out, and where their carries go. An alert, not a
 * probability change: a venue line far from the books' after the news is where
 * a timing edge would be — check it on the venue before anything else.
 */
export function RbOutAlerts({ alerts }: { alerts: RbOutAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <Card className="border-warning/25 bg-warning/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" aria-hidden="true" /> Running back out
        </CardTitle>
        <CardDescription>
          Teammates&apos; rushing lines, each venue against the books, and where the fitted redistribution expects the
          vacated carries to go (validated on 2025). An alert to check lines — not a change to any probability.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {alerts.map((a) => (
          <div key={`${a.team}|${a.outPlayer}`}>
            <p className="text-sm">
              <span className="font-semibold">{a.outPlayer}</span> ({a.team}) — {a.status}
              {a.vacatedShare != null && <span className="text-muted-foreground">, {pct(a.vacatedShare)} of carries vacated</span>}
            </p>
            {a.teammates.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No teammate rushing props stored for this game.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Teammate</TableHead>
                    <TableHead className="text-right">Books</TableHead>
                    <TableHead className="text-right">Underdog</TableHead>
                    <TableHead className="text-right">PrizePicks</TableHead>
                    <TableHead className="text-right">Carry share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {a.teammates.map((t) => (
                    <TableRow key={`${t.playerName}|${t.propType}`}>
                      <TableCell>
                        {t.playerName} <span className="text-muted-foreground">· {t.propType}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{t.booksLine}</TableCell>
                      <TableCell className="text-right font-mono">
                        {t.underdogLine != null ? `${t.underdogLine} (${signed(t.underdogGap!)})` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {t.prizePicksLine != null ? `${t.prizePicksLine} (${signed(t.prizePicksGap!)})` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {t.priorShare != null && t.expectedShare != null ? `${pct(t.priorShare)} → ${pct(t.expectedShare)}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
