/** Formatting helpers used across the UI. */

export function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Signed currency, e.g. "+$45.00" / "-$5.00" — for P/L displays. */
export function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatSignedNumber(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

export function formatNumber(value: number, digits = 1): string {
  return value.toFixed(digits);
}

/** "OVER 25.5" style label. */
export function formatPropLine(direction: string, line: number): string {
  return `${direction} ${line}`;
}

export function titleCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
