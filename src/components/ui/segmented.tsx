import { cn } from "@/lib/utils/cn";

/**
 * One-of-many choices (a filter, a view) as a segmented control: a Layer 1
 * track, with the active segment raised to Layer 2. Matches the Tabs list.
 */
export const segmentGroupClass =
  "no-scrollbar inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1";

export function segmentClass(active: boolean) {
  return cn(
    "inline-flex h-11 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 sm:h-8",
    active ? "bg-elevated text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
  );
}

/** Many-of-many toggles (enabled sports, leagues): chips that tint when on. */
export function toggleChipClass(on: boolean) {
  return cn(
    "inline-flex h-11 cursor-pointer items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150 sm:h-8",
    on
      ? "border-primary/30 bg-primary/10 text-primary"
      : "border-border bg-transparent text-muted-foreground hover:border-border-strong hover:text-foreground",
  );
}
