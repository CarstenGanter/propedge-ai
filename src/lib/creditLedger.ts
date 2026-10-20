import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@/lib/db/client";
import type { OddsApiCall } from "@/lib/providers/live/oddsApiLedger";

/**
 * The credit ledger (CreditSpend). Callers say what kind of fetch they are with
 * withCreditKind; every paid Odds API request made inside is logged under that
 * kind with its exact cost. Requests made outside any tag log as "untagged".
 */
const kind = new AsyncLocalStorage<string>();

export function withCreditKind<T>(k: string, fn: () => Promise<T>): Promise<T> {
  return kind.run(k, fn);
}

export async function logOddsApiCall(call: OddsApiCall): Promise<void> {
  await prisma.creditSpend.create({
    data: {
      at: new Date(),
      kind: kind.getStore() ?? "untagged",
      credits: call.credits ?? 0,
      remaining: call.remaining,
      endpoint: call.url.replace(/^https:\/\/api\.the-odds-api\.com\/v4/, ""),
      status: call.status,
    },
  });
}

/** Credits spent since `since`, by kind. */
export async function creditsByKind(since: Date): Promise<{ kind: string; credits: number; calls: number }[]> {
  const rows = await prisma.creditSpend.groupBy({ by: ["kind"], where: { at: { gte: since } }, _sum: { credits: true }, _count: true });
  return rows.map((r) => ({ kind: r.kind, credits: r._sum.credits ?? 0, calls: r._count })).sort((a, b) => b.credits - a.credits);
}
