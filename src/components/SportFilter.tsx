"use client";

import { segmentClass, segmentGroupClass } from "@/components/ui/segmented";

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
    <div className={segmentGroupClass} role="group" aria-label="Filter">
      {options.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          aria-pressed={value === s}
          className={segmentClass(value === s)}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
