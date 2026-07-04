"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
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

const AXIS = { stroke: "#5b667d", fontSize: 11 } as const;
const GRID = "#1c2536";

const tooltipStyle = {
  background: "#0d1320",
  border: "1px solid #212a3b",
  borderRadius: 10,
  fontSize: 12,
  color: "#e6eaf2",
};

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
        <defs>
          <linearGradient id="plLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2dd4bf" />
            <stop offset="100%" stopColor="#7c8cf8" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v) => `$${v}`} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, name) => [formatCurrency(Number(v)), name === "bankroll" ? "Bankroll" : "P/L"]}
          labelFormatter={(l) => formatSlate(String(l))}
        />
        <ReferenceLine y={data[0]?.bankroll - data[0]?.profitLoss} stroke="#3a4560" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="bankroll"
          stroke="url(#plLine)"
          strokeWidth={2.5}
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
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="bucket" {...AXIS} />
        <YAxis domain={[0, 100]} {...AXIS} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, name) => [`${Number(v)}%`, name === "predicted" ? "Predicted" : "Actual hit rate"]}
        />
        <Line type="monotone" dataKey="predicted" stroke="#7c8cf8" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
        <Line type="monotone" dataKey="actual" stroke="#2dd4bf" strokeWidth={2.5} dot={{ r: 3 }} />
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
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} {...AXIS} />
        <YAxis domain={[0, 100]} {...AXIS} tickFormatter={(v) => `${v}%`} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v)}%`, "Rolling hit rate"]} />
        <ReferenceLine y={50} stroke="#3a4560" strokeDasharray="4 4" />
        <Line type="monotone" dataKey="hitRate" stroke="#34d399" strokeWidth={2.5} dot={false} />
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
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} {...AXIS} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="key" width={90} {...AXIS} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, _n, item) => [
            `${Number(v)}% (${(item as { payload?: { decided?: number } })?.payload?.decided ?? 0} decided)`,
            "Hit rate",
          ]}
        />
        <Bar dataKey="hitRate" fill="#2dd4bf" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
