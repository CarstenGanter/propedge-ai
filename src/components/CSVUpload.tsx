"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importPropsFromCsv } from "@/server/actions/props";
import { CSV_TEMPLATE_HEADERS } from "@/lib/ingest/props";

const SAMPLE_ROW =
  "NBA,NBA,2026-06-30,Jalen Brunson,Knicks,Celtics,Points,25.5,OVER,2026-06-30T23:00:00Z,27.1,,active,";

export function CSVUpload() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<{ imported: number; errors: { row: number; message: string }[] } | null>(
    null,
  );
  const [text, setText] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  function submit(csv: string) {
    if (!csv.trim()) return;
    startTransition(async () => {
      const res = await importPropsFromCsv(csv);
      setResult({ imported: res.imported, errors: res.errors });
      if (res.imported > 0) {
        setText("");
        router.refresh();
      }
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => submit(String(reader.result));
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const csv = CSV_TEMPLATE_HEADERS.join(",") + "\n" + SAMPLE_ROW + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "propedge-props-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" /> Import props from CSV
        </CardTitle>
        <CardDescription>
          Required columns: sport, league, gameDate, playerName, team, opponent, propType, line,
          overUnder. Optional: startTime, projection, payoutMultiplier, injuryStatus, notes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={pending}>
            <Upload className="h-4 w-4" /> Choose CSV file
          </Button>
          <Button variant="ghost" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Download template
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">or paste CSV text:</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={CSV_TEMPLATE_HEADERS.join(",")}
          className="h-28 w-full rounded-md border border-border bg-input/60 p-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
        <Button onClick={() => submit(text)} disabled={pending || !text.trim()}>
          {pending ? "Importing…" : "Import pasted CSV"}
        </Button>

        {result && (
          <div className="space-y-1 text-sm">
            <p className="text-success">Imported {result.imported} prop(s).</p>
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-danger/25 bg-danger/5 p-2 text-xs text-danger">
                <p className="font-semibold">{result.errors.length} row(s) skipped:</p>
                {result.errors.slice(0, 8).map((e, i) => (
                  <p key={i}>
                    Row {e.row}: {e.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
