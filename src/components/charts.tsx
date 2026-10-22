"use client";

import * as React from "react";
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
 * Chart palette, read from the theme so charts follow the dark and light
 * themes. Series are the periwinkle accent and orange: the pair stays distinct
 * for colour-blind readers, and neither is a verdict colour. The fallback is
 * the dark theme, used only before the browser can be asked.
 */
interface ChartPalette {
  series1: string;
  series2: string;
  axis: string;
  grid: string;
  reference: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

const DEFAULT_PALETTE: ChartPalette = {
  series1: "#93a4ff",
  series2: "#fb923c",
  axis: "#71717a",
  grid: "rgb(255 255 255 / 0.06)",
  reference: "#52525b",
  tooltipBg: "#1c1c1f",
  tooltipBorder: "rgb(63 63 70 / 0.6)",
  tooltipText: "#f4f4f5",
};

function readPalette(): ChartPalette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    series1: v("--color-chart-1", DEFAULT_PALETTE.series1),
    series2: v("--color-chart-2", DEFAULT_PALETTE.series2),
    axis: v("--color-chart-axis", DEFAULT_PALETTE.axis),
    grid: v("--color-chart-grid", DEFAULT_PALETTE.grid),
    reference: v("--color-chart-reference", DEFAULT_PALETTE.reference),
    // Tooltips are Layer 2: a solid popover surface, readable over any series.
    tooltipBg: v("--color-popover", DEFAULT_PALETTE.tooltipBg),
    tooltipBorder: v("--color-elevated-border", DEFAULT_PALETTE.tooltipBorder),
    tooltipText: v("--color-popover-foreground", DEFAULT_PALETTE.tooltipText),
  };
}

/** The current theme's chart colours, updated when the edition is switched. */
function useChartPalette(): ChartPalette {
  // Charts only draw in the browser (ResponsiveContainer measures first), so
  // reading the DOM in the initializer cannot mismatch the server render.
  const [palette, setPalette] = React.useState<ChartPalette>(() =>
    typeof window === "undefined" ? DEFAULT_PALETTE : readPalette(),
  );
  React.useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return palette;
}

function chrome(c: ChartPalette) {
  return {
    axis: { stroke: c.axis, fontSize: 11 } as const,
    tooltip: {
      background: c.tooltipBg,
      border: `1px solid ${c.tooltipBorder}`,
      borderRadius: 8,
      boxShadow: "0 1px 2px rgb(0 0 0 / 0.4), 0 12px 32px -12px rgb(0 0 0 / 0.6)",
      fontSize: 12,
      fontVariantNumeric: "tabular-nums",
      color: c.tooltipText,
    },
    legend: { fontSize: 12, color: c.axis } as const,
  };
}

export function ProfitLossChart({
  data,
}: {
  data: { date: string; bankroll: number; profitLoss: number }[];
}) {
  const c = useChartPalette();
  const ui = chrome(c);
  if (data.length === 0) {
    return <EmptyState title="No settled bankroll history yet" description="Settle picks or load demo data to see your P/L curve." />;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} {...ui.axis} />
        <YAxis {...ui.axis} tickFormatter={(v) => `$${v}`} />
        <Tooltip
          contentStyle={ui.tooltip}
          formatter={(v, name) => [formatCurrency(Number(v)), name === "bankroll" ? "Bankroll" : "P/L"]}
          labelFormatter={(l) => formatSlate(String(l))}
        />
        <ReferenceLine y={data[0]?.bankroll - data[0]?.profitLoss} stroke={c.reference} strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="bankroll"
          stroke={c.series1}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CalibrationChart({ data }: { data: CalibrationPoint[] }) {
  const c = useChartPalette();
  const ui = chrome(c);
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
        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
        <XAxis dataKey="bucket" {...ui.axis} />
        <YAxis domain={[0, 100]} {...ui.axis} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          contentStyle={ui.tooltip}
          formatter={(v, name) => [`${Number(v)}%`, name === "predicted" ? "Predicted" : "Actual hit rate"]}
        />
        <Legend wrapperStyle={ui.legend} formatter={(v) => (v === "predicted" ? "Predicted" : "Actual hit rate")} />
        <Line type="monotone" dataKey="predicted" stroke={c.series2} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
        <Line type="monotone" dataKey="actual" stroke={c.series1} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TrendChart({ data }: { data: { date: string; hitRate: number }[] }) {
  const c = useChartPalette();
  const ui = chrome(c);
  if (data.length === 0) {
    return <EmptyState title="No trend yet" description="Settle picks to see your rolling hit-rate trend." />;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} {...ui.axis} />
        <YAxis domain={[0, 100]} {...ui.axis} tickFormatter={(v) => `${v}%`} />
        <Tooltip contentStyle={ui.tooltip} formatter={(v) => [`${Number(v)}%`, "Rolling hit rate"]} />
        <ReferenceLine y={50} stroke={c.reference} strokeDasharray="4 4" />
        <Line type="monotone" dataKey="hitRate" stroke={c.series1} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AccuracyChart({ data }: { data: GroupedRecord[] }) {
  const c = useChartPalette();
  const ui = chrome(c);
  const chartData = data
    .filter((d) => d.record.hits + d.record.misses > 0)
    .map((d) => ({ key: d.key, hitRate: Math.round(d.record.hitRate), decided: d.record.hits + d.record.misses }));
  if (chartData.length === 0) {
    return <EmptyState title="No settled picks yet" description="Accuracy by group appears once picks are decided." />;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 44)}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} {...ui.axis} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="key" width={90} {...ui.axis} />
        <Tooltip
          contentStyle={ui.tooltip}
          formatter={(v, _n, item) => [
            `${Number(v)}% (${(item as { payload?: { decided?: number } })?.payload?.decided ?? 0} decided)`,
            "Hit rate",
          ]}
        />
        <Bar dataKey="hitRate" fill={c.series1} radius={[0, 2, 2, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
