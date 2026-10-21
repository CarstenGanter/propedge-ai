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
      credits: call.credits,
      remaining: call.remaining,
      endpoint: call.url.replace(/^https:\/\/api\.the-odds-api\.com\/v4/, ""),
      status: call.status,
    },
  });
}

/** Credits spent since `since`, by kind; `unknownCost` counts timed-out or failed calls that may have been charged. */
export async function creditsByKind(since: Date): Promise<{ kind: string; credits: number; calls: number; unknownCost: number }[]> {
  const rows = await prisma.creditSpend.findMany({ where: { at: { gte: since } }, select: { kind: true, credits: true } });
  const byKind = new Map<string, { kind: string; credits: number; calls: number; unknownCost: number }>();
  for (const r of rows) {
    const k = byKind.get(r.kind) ?? byKind.set(r.kind, { kind: r.kind, credits: 0, calls: 0, unknownCost: 0 }).get(r.kind)!;
    k.calls++;
    if (r.credits == null) k.unknownCost++;
    else k.credits += r.credits;
  }
  return [...byKind.values()].sort((a, b) => b.credits - a.credits);
}
