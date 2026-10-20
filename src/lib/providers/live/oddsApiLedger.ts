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

export async function reportOddsApiCall(call: OddsApiCall): Promise<void> {
  if (typeof window !== "undefined" || process.env.VITEST) return;
  if (!call.credits) return; // free calls (the events list) cost nothing to log
  try {
    const { logOddsApiCall } = await import("@/lib/creditLedger");
    await logOddsApiCall({ ...call, url: redactKey(call.url) });
  } catch {
    // The ledger must never cost a fetch.
  }
}
