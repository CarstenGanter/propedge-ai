import { NflGamedayView } from "@/components/nfl/NflGamedayView";
import { getNflGamedayData } from "@/lib/nfl/gameday";
import { resolveNflSlateDate } from "@/lib/nfl/schedule";
import { todayNflSlate } from "@/lib/nfl/slate";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function NflGamedayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const today = todayNflSlate();
  let date = params.date && DATE_RE.test(params.date) ? params.date : null;
  if (!date) {
    // Today if there are games today, else the next game day (free, cached scoreboard calls).
    const resolved = await resolveNflSlateDate(today);
    date = resolved?.date ?? today;
  }
  const data = await getNflGamedayData(date, today);
  return <NflGamedayView data={data} />;
}
