/**
 * Hands every Odds API response to the credit ledger (src/lib/creditLedger.ts)
 * without making the providers depend on the database: the ledger is loaded
 * on demand, only on the server, never under tests, and a failed write never
 * fails a fetch.
 */
export interface OddsApiCall {
  url: string;
  credits: number | null;
  remaining: number | null;
  status: number;
}

/** The request URL without its API key. */
export function redactKey(url: string): string {
  return url.replace(/([?&])apiKey=[^&]*&?/, "$1").replace(/[?&]$/, "");
}

/**
 * Whether a call belongs in the ledger: anything that cost credits, and any
 * request that timed out or failed (status 0) — the server may have charged
 * it, so it is logged with an unknown cost. A free call (the events list) is
 * skipped.
 */
export function shouldLog(call: Pick<OddsApiCall, "credits" | "status">): boolean {
  return call.status === 0 || (call.credits != null && call.credits > 0);
}

export async function reportOddsApiCall(call: OddsApiCall): Promise<void> {
  if (typeof window !== "undefined" || process.env.VITEST) return;
  if (!shouldLog(call)) return;
  try {
    const { logOddsApiCall } = await import("@/lib/creditLedger");
    await logOddsApiCall({ ...call, credits: call.status === 0 ? null : call.credits, url: redactKey(call.url) });
  } catch (e) {
    // The ledger must never cost a fetch, but a lost entry must not be silent.
    console.error(`credit ledger: entry NOT written for ${redactKey(call.url)} (${call.credits ?? "unknown"} credits): ${e instanceof Error ? e.message : String(e)}`);
  }
}
