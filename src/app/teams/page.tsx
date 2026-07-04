import { TeamPicksView } from "@/components/TeamPicksView";
import { getTeamPicksForDate } from "@/lib/queries";
import { hasKey } from "@/lib/providers/config";
import { todaySlate } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const date = todaySlate();
  const picks = await getTeamPicksForDate(date);
  return <TeamPicksView picks={picks} date={date} oddsConfigured={hasKey("ODDS_API_KEY")} />;
}
