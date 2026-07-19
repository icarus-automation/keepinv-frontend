/**
 * The consolidated cross-store report (`GET /reports/consolidated`, owner/admin only). Aggregates
 * every store the caller owns/administers server-side, so no org switching is needed to build the
 * overview. All money fields are plain numbers in pesos (matching the profit-loss report).
 */

/** One store's roll-up for the reporting window. */
export interface ConsolidatedStore {
  organizationId: string;
  organizationName: string;
  slug: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  salesCount: number;
}

/** The combined total across every store in the report. */
export interface ConsolidatedCombined {
  revenue: number;
  cogs: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  salesCount: number;
  storeCount: number;
}

/** The full response. `stores` is sorted by `netProfit` DESC, so `stores[0]` is the leader. */
export interface ConsolidatedReport {
  from: string;
  to: string;
  stores: ConsolidatedStore[];
  combined: ConsolidatedCombined;
}
