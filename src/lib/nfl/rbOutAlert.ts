import { REDISTRIBUTION, redistribute } from "./vacatedVolume";

/**
 * "RB X out → teammates' rushing lines" (pure, tested). An alert, not a
 * probability adjustment: it points at the props where a news-timing edge
 * would show — a venue line that hasn't caught up with the books — and at how
 * the fitted carries redistribution (task 4, validated on 2025) expects the
 * vacated carries to land.
 */

export const RUSHING_PROPS = ["Rushing Yards", "Rush Attempts", "Rush+Rec Yards"];

export interface AlertProp {
  playerName: string;
  propType: string;
  gsisId: string | null;
  /** The books' reference line. */
  booksLine: number;
  underdogLine: number | null;
  prizePicksLine: number | null;
}

export interface RbOutTeammate extends AlertProp {
  /** Venue line minus the books' line (stat units). */
  underdogGap: number | null;
  prizePicksGap: number | null;
  /** Mean carry share over his last four games, and after the out RB's share is redistributed. */
  priorShare: number | null;
  expectedShare: number | null;
}

export interface RbOutAlert {
  team: string;
  outPlayer: string;
  status: string;
  /** The out RB's own recent carry share, vacated. */
  vacatedShare: number | null;
  teammates: RbOutTeammate[];
}

/** Recent carry shares for a team's players, keyed by gsis id. */
export type CarryShares = Map<string, { pos: string; prior: number }>;

export function buildRbOutAlert(input: {
  team: string;
  outPlayer: { name: string; gsisId: string | null };
  status: string;
  props: AlertProp[];
  shares: CarryShares | null;
}): RbOutAlert {
  const { shares } = input;
  let expected: Map<string, number> | null = null;
  if (shares && input.outPlayer.gsisId && shares.has(input.outPlayer.gsisId)) {
    expected = redistribute(
      [...shares.entries()].map(([id, s]) => ({ id, pos: s.pos, prior: s.prior, active: id !== input.outPlayer.gsisId })),
      REDISTRIBUTION.carries,
    );
  }
  const teammates = input.props
    .filter((p) => RUSHING_PROPS.includes(p.propType) && p.gsisId !== input.outPlayer.gsisId && p.playerName !== input.outPlayer.name)
    .map((p) => ({
      ...p,
      underdogGap: p.underdogLine != null ? p.underdogLine - p.booksLine : null,
      prizePicksGap: p.prizePicksLine != null ? p.prizePicksLine - p.booksLine : null,
      priorShare: p.gsisId && shares?.get(p.gsisId) ? shares.get(p.gsisId)!.prior : null,
      expectedShare: p.gsisId && expected?.has(p.gsisId) ? expected.get(p.gsisId)! : null,
    }))
    .sort((a, b) => (b.expectedShare ?? b.priorShare ?? 0) - (a.expectedShare ?? a.priorShare ?? 0));
  return {
    team: input.team,
    outPlayer: input.outPlayer.name,
    status: input.status,
    vacatedShare: input.outPlayer.gsisId && shares?.get(input.outPlayer.gsisId) ? shares.get(input.outPlayer.gsisId)!.prior : null,
    teammates,
  };
}

const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One line per teammate prop, for the scheduler log. */
export function formatRbOutAlert(a: RbOutAlert): string[] {
  const head = `RB ${a.outPlayer} (${a.team}) ${a.status}${a.vacatedShare != null ? `, ${pct(a.vacatedShare)} of carries vacated` : ""} → teammates' rushing lines`;
  if (a.teammates.length === 0) return [`${head}: none stored`];
  return [
    head,
    ...a.teammates.map((t) => {
      const venues = [
        t.underdogGap != null ? `Underdog ${t.underdogLine} (${signed(t.underdogGap)} vs books)` : null,
        t.prizePicksGap != null ? `PrizePicks ${t.prizePicksLine} (${signed(t.prizePicksGap)})` : null,
      ].filter(Boolean);
      const share = t.priorShare != null && t.expectedShare != null ? `; carries ${pct(t.priorShare)} → ${pct(t.expectedShare)}` : "";
      return `  ${t.playerName} ${t.propType}: books ${t.booksLine}${venues.length ? `, ${venues.join(", ")}` : ", no venue line"}${share}`;
    }),
  ];
}
