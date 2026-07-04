"use client";

import { cn } from "@/lib/utils/cn";

export function SportFilter({
  sports,
  value,
  onChange,
}: {
  sports: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const options = ["All", ...sports];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            value === s
              ? "border-primary/40 bg-primary/12 text-primary"
              : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
