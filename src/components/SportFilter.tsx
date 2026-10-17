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
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
      {options.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          aria-pressed={value === s}
          className={cn(
            "inline-flex h-9 cursor-pointer items-center rounded-full border px-3.5 text-xs font-medium transition-colors",
            value === s
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:border-foreground/60 hover:text-foreground",
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
