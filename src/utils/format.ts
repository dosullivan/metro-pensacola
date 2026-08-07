export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) {
    return '$0';
  }
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (absolute >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(0)}M`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

export function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits
  }).format(value);
}

export function formatMiles(value: number): string {
  return `${formatNumber(value, 1)} mi`;
}

export function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 0)}%`;
}
