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
  {
    feedName: "Cam Sample",
    nflverseName: "Drew Sample",
    note: "ESPN BET's label for Drew Sample (CIN TE) on 2026-11-01 (receiving yards 9.5 beside the other books' 8.5, absent from Drew's prop); Cameron Sample is a defensive lineman. Approved 2026-11-04.",
  },
  {
    feedName: "Chris Smith II",
    nflverseName: "Geno Smith",
    note: "ESPN BET's label for Geno Smith (NYJ) on 2026-11-01 (rushing yards 7.5 beside seven books' 6.5, absent from Geno's prop). nflverse's Chris Smith II is a Jets DB: tried only when the name matches no one, so if he plays, a prop of his name grades as him. Approved 2026-11-04.",
  },
];

/** The nflverse name for a feed name in the table, or null. Suffixes and case don't matter. */
export function aliasFor(feedName: string): string | null {
  const key = baseName(feedName);
  return PLAYER_ALIASES.find((a) => baseName(a.feedName) === key)?.nflverseName ?? null;
}
