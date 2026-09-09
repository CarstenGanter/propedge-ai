import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Persistent key/value cache (SQLite) for free-provider payloads. In-memory
 * caches don't survive the headless daily job (a separate process) or a dev
 * server restart; this one does, so ESPN game summaries, weather, aggregated
 * defense stats and the last-known Odds API credit balance are shared.
 */

export interface CacheHit<T> {
  value: T;
  updatedAt: Date;
}

export async function cacheGet<T>(key: string, maxAgeMs?: number): Promise<CacheHit<T> | null> {
  const row = await prisma.providerCache.findUnique({ where: { key } });
  if (!row) return null;
  if (maxAgeMs != null && Date.now() - row.updatedAt.getTime() > maxAgeMs) return null;
  try {
    return { value: JSON.parse(row.json) as T, updatedAt: row.updatedAt };
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.providerCache.upsert({
    where: { key },
    update: { json },
    create: { key, json },
  });
}

/** Last-known Odds API credit balance (recorded from response headers). */
export interface OddsCreditsSnapshot {
  remaining: number;
  used: number | null;
  at: string; // ISO
}

export const ODDS_CREDITS_KEY = "odds:credits";

export async function recordOddsCredits(remaining: number | null, used: number | null): Promise<void> {
  if (remaining == null || !Number.isFinite(remaining)) return;
  await cacheSet<OddsCreditsSnapshot>(ODDS_CREDITS_KEY, {
    remaining,
    used,
    at: new Date().toISOString(),
  });
}

export async function getOddsCredits(): Promise<OddsCreditsSnapshot | null> {
  const hit = await cacheGet<OddsCreditsSnapshot>(ODDS_CREDITS_KEY);
  return hit?.value ?? null;
}
