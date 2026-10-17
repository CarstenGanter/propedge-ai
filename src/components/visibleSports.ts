import { SPORTS, type Sport } from "@/types";
import { TEAM_LEAGUES, type League } from "@/lib/teamLeagues";

/**
 * The sports and team leagues the UI offers. A display filter only: SPORTS
 * and TEAM_LEAGUES, settings and every provider keep the full lists, and past
 * picks from other sports still appear in history so lists match the totals
 * the backend computes.
 */
export const VISIBLE_SPORTS: readonly Sport[] = SPORTS.filter((s) => s === "NFL" || s === "NBA");
export const VISIBLE_LEAGUES: readonly League[] = TEAM_LEAGUES.filter((l) => l === "NFL");

export function isVisibleSport(s: string): boolean {
  return (VISIBLE_SPORTS as readonly string[]).includes(s);
}

export function isVisibleLeague(l: string): boolean {
  return (VISIBLE_LEAGUES as readonly string[]).includes(l);
}
