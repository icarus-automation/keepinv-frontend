/** A tenant-configurable grouping for expenses (e.g. "Rent", "Utilities"). */
export interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating or updating an expense category. */
export interface ExpenseCategoryRequest {
  name: string;
  description?: string;
}

/** A recorded operating cost. `amount` is the decimal string the API returns. */
export interface Expense {
  id: string;
  amount: string;
  note: string | null;
  incurredAt: string;
  isArchived: boolean;
  expenseCategoryId: string;
  expenseCategory: { id: string; name: string } | null;
  user: { id: string; name: string | null; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating or updating an expense. */
export interface ExpenseRequest {
  expenseCategoryId: string;
  amount: number;
  /** ISO 8601 date the cost applies to. */
  incurredAt: string;
  note?: string;
}

/** One expense category's total spend within the P&L window. */
export interface ExpenseCategoryTotal {
  categoryId: string;
  categoryName: string;
  amount: number;
}

/** Revenue vs. cost for one product or category sold in the window — the margin breakdown. */
export interface MarginRow {
  id: string;
  name: string;
  sku: string | null;
  unitsSold: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
}

/** Profit & loss for a period. All money fields are numbers (pesos). */
export interface ProfitLossReport {
  from: string;
  to: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  salesCount: number;
  expensesByCategory: ExpenseCategoryTotal[];
  marginByProduct: MarginRow[];
  marginByCategory: MarginRow[];
  /** Units and revenue per drink flavor. Empty for a catalog without a size/flavor menu. */
  flavorMix: FlavorMixRow[];
}

/**
 * One flavor's share of the period, folded across every size it sold in. Keyed on the sale item's
 * snapshot name, so a renamed or retired flavor keeps its history instead of vanishing.
 */
export interface FlavorMixRow {
  id: string | null;
  name: string;
  unitsSold: number;
  revenue: number;
}
