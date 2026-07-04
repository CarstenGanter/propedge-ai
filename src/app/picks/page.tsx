import { prisma } from "@/lib/db/client";
import { PicksView } from "@/components/PicksView";
import { getPicksForDate } from "@/lib/queries";
import { todaySlate } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

export default async function PicksPage() {
  const date = todaySlate();
  const [picks, availablePropCount] = await Promise.all([
    getPicksForDate(date),
    prisma.playerProp.count({ where: { date, status: "pending" } }),
  ]);

  return <PicksView picks={picks} date={date} availablePropCount={availablePropCount} />;
}
