import { ParlayBuilder } from "@/components/ParlayBuilder";
import { ParlaysList } from "@/components/ParlaysList";
import { TeamParlayBuilder } from "@/components/TeamParlayBuilder";
import { TeamParlaysList } from "@/components/TeamParlaysList";
import { SectionHeading } from "@/components/common";
import {
  getParlays,
  getPicksForParlayBuilder,
  getTeamParlays,
  getTeamPicksForParlayBuilder,
} from "@/lib/queries";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function ParlaysPage() {
  const [picks, parlays, teamPicks, teamParlays, settings] = await Promise.all([
    getPicksForParlayBuilder(),
    getParlays(),
    getTeamPicksForParlayBuilder(),
    getTeamParlays(),
    getSettings(),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Parlay Builder</h1>
        <p className="text-sm text-muted-foreground">
          Combine picks into a parlay. Player-prop parlays use a manual payout multiplier; team
          (moneyline) parlays compute the payout from each team&apos;s price. Correlation warnings help
          you avoid over-concentrated risk. Parlays are high variance.
        </p>
      </div>

      <section className="space-y-4">
        <SectionHeading
          title="Player prop parlays"
          description="Combine Over/Under props. Enter the payout multiplier manually."
        />
        <ParlayBuilder picks={picks} defaultStake={settings.defaultStake} />
        <div className="space-y-3">
          <SectionHeading title="Your prop parlays" description="Settled automatically as their legs settle." />
          <ParlaysList parlays={parlays} />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          title="Team parlays (game winners)"
          description="Pick multiple teams to win — the combined moneyline odds and payout are computed from each team's price."
        />
        <TeamParlayBuilder picks={teamPicks} defaultStake={settings.defaultStake} />
        <div className="space-y-3">
          <SectionHeading title="Your team parlays" description="Settled automatically as each game finishes." />
          <TeamParlaysList parlays={teamParlays} />
        </div>
      </section>
    </div>
  );
}
