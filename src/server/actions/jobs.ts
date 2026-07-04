"use server";

import { revalidatePath } from "next/cache";
import { runDailyRefresh, type DailyRefreshSummary } from "@/jobs/dailyRefresh";

/** Manual trigger for the same routine cron runs: fetch all enabled sports + generate. */
export async function runDailyRefreshAction(): Promise<DailyRefreshSummary> {
  const summary = await runDailyRefresh();
  if (summary.ok) {
    for (const p of ["/", "/picks", "/research", "/results", "/analytics"]) revalidatePath(p);
  }
  return summary;
}
