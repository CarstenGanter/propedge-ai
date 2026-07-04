import type { Direction, Sport } from "@/types";

/**
 * Underdog Fantasy ingestion seam.
 *
 * Underdog has no official public API, so props enter the app via:
 *   1. CSV upload (see src/lib/ingest/props.ts)
 *   2. Manual entry form
 *   3. This provider — a placeholder for a future *legal* source (official API,
 *      an exported CSV feed, or a permitted integration). It intentionally does
 *      not scrape anything by default.
 */

export interface RawUnderdogProp {
  sport: Sport | string;
  league: string;
  gameDate: string; // YYYY-MM-DD
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: number;
  overUnder: Direction;
  source: string;
  startTime?: string;
  projection?: number;
  payoutMultiplier?: number;
  injuryStatus?: string;
  notes?: string;
}

export interface UnderdogProvider {
  /** Fetch today's props. Returns [] until a legal source is configured. */
  fetchProps(date: string): Promise<RawUnderdogProp[]>;
  isConfigured(): boolean;
}

export const underdogProvider: UnderdogProvider = {
  async fetchProps() {
    // No legal automated source is wired. Use CSV upload or manual entry.
    return [];
  },
  isConfigured() {
    return false;
  },
};
