"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CalibrationPoint } from "@/lib/analysis/calibration";
import type { GroupedRecord } from "@/lib/analytics";
import { formatSlate } from "@/lib/utils/dates";
import { formatCurrency } from "@/lib/utils/format";
import { EmptyState } from "@/components/common";

/**
 * Chart palette for the dark zinc surface. Series colors are a validated
 * categorical pair (CVD-safe, ≥3:1 on the card surface); chrome stays neutral
 * so the grid/axes recede behind the data.
 */
export const CHART_COLORS = {
  series1: "#199e70", // emerald — primary data series
  series2: "#3987e5", // blue — comparison series (calibration "predicted")
  axis: "#71717a",
  grid: "#1f1f23",
  reference: "#3f3f46",
  tooltipBg: "#0e0e11",
  tooltipBorder: "#232329",
  tooltipText: "#ededf0",
} as const;

const AXIS = { stroke: CHART_COLORS.axis, fontSize: 11 } as const;

const tooltipStyle = {
  background: CHART_COLORS.tooltipBg,
  border: `1px solid ${CHART_COLORS.tooltipBorder}`,
  borderRadius: 8,
  fontSize: 12,
  color: CHART_COLORS.tooltipText,
};

const legendStyle = { fontSize: 12, color: "#9b9ba4" } as const;

export function ProfitLossChart({
  data,
}: {
  data: { date: string; bankroll: number; profitLoss: number }[];
}) {
  if (data.length === 0) {
    return <EmptyState title="No settled bankroll history yet" description="Settle picks or load demo data to see your P/L curve." />;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v) => `$${v}`} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, name) => [formatCurrency(Number(v)), name === "bankroll" ? "Bankroll" : "P/L"]}
          labelFormatter={(l) => formatSlate(String(l))}
        />
        <ReferenceLine y={data[0]?.bankroll - data[0]?.profitLoss} stroke={CHART_COLORS.reference} strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="bankroll"
          stroke={CHART_COLORS.series1}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CalibrationChart({ data }: { data: CalibrationPoint[] }) {
  const hasData = data.some((d) => d.count > 0);
  if (!hasData) {
    return (
      <EmptyState
        title="Not enough settled picks to calibrate"
        description="Once picks are settled, this compares predicted confidence against actual hit rate."
      />
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
        <XAxis dataKey="bucket" {...AXIS} />
        <YAxis domain={[0, 100]} {...AXIS} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, name) => [`${Number(v)}%`, name === "predicted" ? "Predicted" : "Actual hit rate"]}
        />
        <Legend wrapperStyle={legendStyle} formatter={(v) => (v === "predicted" ? "Predicted" : "Actual hit rate")} />
        <Line type="monotone" dataKey="predicted" stroke={CHART_COLORS.series2} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
        <Line type="monotone" dataKey="actual" stroke={CHART_COLORS.series1} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TrendChart({ data }: { data: { date: string; hitRate: number }[] }) {
  if (data.length === 0) {
    return <EmptyState title="No trend yet" description="Settle picks to see your rolling hit-rate trend." />;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} {...AXIS} />
        <YAxis domain={[0, 100]} {...AXIS} tickFormatter={(v) => `${v}%`} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v)}%`, "Rolling hit rate"]} />
        <ReferenceLine y={50} stroke={CHART_COLORS.reference} strokeDasharray="4 4" />
        <Line type="monotone" dataKey="hitRate" stroke={CHART_COLORS.series1} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AccuracyChart({ data }: { data: GroupedRecord[] }) {
  const chartData = data
    .filter((d) => d.record.hits + d.record.misses > 0)
    .map((d) => ({ key: d.key, hitRate: Math.round(d.record.hitRate), decided: d.record.hits + d.record.misses }));
  if (chartData.length === 0) {
    return <EmptyState title="No settled picks yet" description="Accuracy by group appears once picks are decided." />;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 44)}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} {...AXIS} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="key" width={90} {...AXIS} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, _n, item) => [
            `${Number(v)}% (${(item as { payload?: { decided?: number } })?.payload?.decided ?? 0} decided)`,
            "Hit rate",
          ]}
        />
        <Bar dataKey="hitRate" fill={CHART_COLORS.series1} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
