import { baseName } from "./gradeProps";

/**
 * Feed names nflverse doesn't know, mapped to the player they are. Research
 * grading (research:skill) consults this only after the name itself found no
 * player on either team that week, so a real player of the feed's name always
 * wins. Each entry is approved by hand: a wrong alias grades the wrong human.
 */
export const PLAYER_ALIASES: { feedName: string; nflverseName: string; note: string }[] = [
  {
    feedName: "Elijah Dotson",
    nflverseName: "Jahan Dotson",
    note: "ESPN BET's label for Jahan Dotson (ATL WR) on 2026-10-11/18/25, beside the other books' Jahan Dotson at near-identical lines; Elijah Dotson last played in 2024. Approved 2026-10-27.",
  },
  {
    feedName: "Elerson G. Smith",
    nflverseName: "Geno Smith",
    note: "ESPN BET's label for Geno Smith on 2026-10-11 (passing yards 204.5 beside seven books' ~205.5); Elerson Smith is a linebacker. Approved 2026-10-27.",
  },
];

/** The nflverse name for a feed name in the table, or null. Suffixes and case don't matter. */
export function aliasFor(feedName: string): string | null {
  const key = baseName(feedName);
  return PLAYER_ALIASES.find((a) => baseName(a.feedName) === key)?.nflverseName ?? null;
}
