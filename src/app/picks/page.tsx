import { prisma } from "@/lib/db/client";
import { PicksView } from "@/components/PicksView";
import { getPicksForDate } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { todaySlate } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

export default async function PicksPage() {
  const date = todaySlate();
  const [picks, availablePropCount, settings] = await Promise.all([
    getPicksForDate(date),
    prisma.playerProp.count({ where: { date, status: "pending" } }),
    getSettings(),
  ]);

  return (
    <PicksView
      picks={picks}
      date={date}
      availablePropCount={availablePropCount}
      profile={settings.scoringProfile}
    />
  );
}
