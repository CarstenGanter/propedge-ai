/** Date helpers. Slate dates are stored as "YYYY-MM-DD" strings (local day). */

export function toSlateDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todaySlate(): string {
  return toSlateDate(new Date());
}

/** Add N days to a slate date string and return a new slate date string. */
export function addDaysToSlate(slate: string, days: number): string {
  const d = parseSlate(slate);
  d.setDate(d.getDate() + days);
  return toSlateDate(d);
}

export function parseSlate(slate: string): Date {
  const [y, m, d] = slate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatSlate(slate: string): string {
  const d = parseSlate(slate);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(dt: Date | string | null | undefined): string {
  if (!dt) return "TBD";
  const d = typeof dt === "string" ? new Date(dt) : dt;
  if (Number.isNaN(d.getTime())) return "TBD";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Fri, Jul 3 · 7:05 PM" — game date + time, falling back to the slate date. */
export function formatGameDateTime(
  dt: Date | string | null | undefined,
  slate?: string | null,
): string {
  if (dt) {
    const d = typeof dt === "string" ? new Date(dt) : dt;
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }
  if (slate) {
    const d = parseSlate(slate);
    return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · TBD`;
  }
  return "TBD";
}

/** ISO week key like "2026-W27" for weekly grouping. */
export function isoWeekKey(slate: string): string {
  const d = parseSlate(slate);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Month key like "2026-06". */
export function monthKey(slate: string): string {
  return slate.slice(0, 7);
}
