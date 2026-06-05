import { Pipe, PipeTransform } from '@angular/core';

const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a peso amount. Accepts the decimal strings the API returns (e.g. "54990")
 * or a number, and renders "₱54,990.00". Returns '' for null/blank/non-finite
 * input so callers can choose their own fallback. Pure: the formatter is built
 * once and reused.
 */
export function formatPeso(value: string | number | null | undefined): string {
  if (value == null || value === '') {
    return '';
  }
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) {
    return '';
  }
  return pesoFormatter.format(amount);
}

/**
 * Formats a peso amount for display, rendering an em dash for missing values. Pair
 * with `tabular-nums` so columns align to the digit.
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: string | number | null | undefined): string {
    return formatPeso(value) || '—';
  }
}
