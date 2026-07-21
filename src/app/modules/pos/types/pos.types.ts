/**
 * Frontend mirror of the backend POS contract (see docs/backend/pos). The backend
 * serializes money as fixed-2 decimal strings; parse with `Number(...)` or
 * `priceToCents` for math, and format with the shared `money` pipe for display.
 */

/** A sale's lifecycle. Mirrors the backend `SaleStatus` enum. */
export type SaleStatus = 'COMPLETED' | 'VOIDED';

/** How a sale was paid. Mirrors the backend `PaymentMethod` enum (reduced to three values). */
export type PaymentMethod = 'CASH' | 'GCASH' | 'BANK_TRANSFER';

/**
 * A search hit from `GET /pos/search-items`: either a stock product (sold by
 * quantity) or a single serialized unit (sold one at a time, anchored by its
 * serial/EPC/asset identifier). `isSellable` already folds in stock and unit
 * status, so the UI only needs to honor it.
 */
export interface PosSearchItem {
  kind: 'PRODUCT' | 'PRODUCT_UNIT';
  productId: string;
  productUnitId?: string;
  name: string;
  sku: string;
  barcode: string | null;
  brand: string | null;
  /** Decimal string, e.g. "549.90". */
  sellingPrice: string;
  quantityOnHand: number;
  isSerialized: boolean;
  /** The unit's anchor identifier (serial, EPC, or asset tag) for PRODUCT_UNIT hits. */
  unitIdentifier?: string;
  unitStatus?: string;
  isSellable: boolean;
  /**
   * false = always sellable and never decremented (a refill) — its count badge is meaningless
   * and hidden. Sent by `search-items` and set by the grid mapper alike.
   */
  isStockTracked: boolean;
  /**
   * Enrichments present only when the item originates from the products-list grid
   * source (the lugawjuan touch POS), not from `search-items`. The grid needs a
   * photo to render each card and a category to group them; both are absent on
   * scanner/search hits, so treat them as optional everywhere they're read.
   */
  imageUrl?: string | null;
  categoryName?: string;
}

/**
 * One size inside a menu group — the priced, stock-bearing product a sale is actually booked
 * against. `available` counts the servings its cup pool still allows.
 */
export interface PosMenuSize {
  productId: string;
  /** The size button's label, e.g. "16oz" or "Iced 22oz". */
  label: string;
  /** Decimal string, e.g. "39.00". The line price is this plus the flavor's `priceDelta`. */
  sellingPrice: string;
  available: number;
  /** false = always sellable: the count is meaningless and stays hidden. */
  isStockTracked: boolean;
  isSellable: boolean;
}

/** A flavor option. Holds no stock of its own; it only shifts the price and names the drink. */
export interface PosMenuFlavor {
  id: string;
  name: string;
  /** Decimal string added to the size price — the premium flavors run "10.00" over. */
  priceDelta: string;
  /** The counter's sold-out toggle: still listed, greyed out, not orderable. */
  isAvailable: boolean;
}

/**
 * One drink line the customer orders by picking a size and then a flavor (`GET /pos/menu`).
 * An empty menu means the tenant sells off the plain product grid instead — that's the whole
 * switch between the lugawjuan POS and the drinks POS, with no per-tenant flag anywhere.
 */
export interface PosMenuGroup {
  id: string;
  name: string;
  description: string | null;
  sizes: PosMenuSize[];
  flavors: PosMenuFlavor[];
}

/**
 * One line in a checkout payload. Serialized units carry a `productUnitId` and quantity 1; a
 * menu-group size carries the `menuFlavorId` the customer picked, which the API requires.
 */
export interface CheckoutItem {
  productId: string;
  productUnitId?: string;
  menuFlavorId?: string;
  quantity: number;
}

/** Body for `POST /pos/checkout`. `amountTendered` is a number with at most 2 decimals. */
export interface CheckoutRequest {
  items: CheckoutItem[];
  paymentMethod: PaymentMethod;
  amountTendered: number;
  note?: string;
}

/** One printed line on a receipt snapshot. */
export interface ReceiptItemData {
  productId: string;
  productUnitId?: string;
  name: string;
  sku: string;
  barcode: string | null;
  /** The flavor ordered ("Taro"). Absent on plain tiles and on snapshots predating the menu. */
  flavor?: string;
  unitIdentifier?: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

/**
 * The immutable receipt snapshot captured at sale time. Note its `status` reflects
 * the moment of sale (always COMPLETED); a later void is reflected on the live
 * `Sale`, not here, so void state must be read from {@link SaleWithRelations}.
 */
export interface ReceiptData {
  saleId: string;
  receiptNo: string;
  /**
   * Daily order number (resets each Manila day): what the kitchen slip and the customer's queue
   * stub call out. Absent on snapshots captured before the feature shipped.
   */
  orderNo?: number;
  status: SaleStatus;
  completedAt: string;
  cashier: { id: string; name: string; email: string };
  items: ReceiptItemData[];
  totals: { subtotal: string; total: string };
  payment: { method: PaymentMethod; amountTendered: string; changeDue: string };
  note?: string;
}

/** A cashier/voider as embedded on a sale. */
export interface PosUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

/** A row in the sales ledger (`GET /pos/sales`). Carries totals and an item count, not the lines. */
export interface SaleListItem {
  id: string;
  receiptNo: string;
  status: SaleStatus;
  subtotal: string;
  total: string;
  /** Cost of goods sold, captured at sale time. Drives the profit report; never shown on receipts. */
  totalCost: string;
  amountTendered: string;
  changeDue: string;
  paymentMethod: PaymentMethod;
  note: string | null;
  completedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  cashier: PosUser | null;
  voidedBy: PosUser | null;
  _count: { items: number };
}

/** A persisted sale line. */
export interface SaleItem {
  id: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  productName: string;
  productSku: string;
  productBarcode: string | null;
  unitIdentifier: string | null;
  /** Snapshot of the flavor ordered, kept even after that flavor is renamed or retired. */
  flavorName: string | null;
  productId: string;
  productUnitId: string | null;
  menuFlavorId: string | null;
}

/** The live sale with the relations the detail pane reads. The receipt body is rendered from the snapshot. */
export interface SaleWithRelations {
  id: string;
  receiptNo: string;
  status: SaleStatus;
  subtotal: string;
  total: string;
  amountTendered: string;
  changeDue: string;
  paymentMethod: PaymentMethod;
  note: string | null;
  completedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  cashier: PosUser | null;
  voidedBy: PosUser | null;
  items: SaleItem[];
}

/** Result of checkout / get-sale / void: the live sale plus its receipt snapshot. */
export interface SaleResult {
  sale: SaleWithRelations;
  receiptData: ReceiptData;
}

/** Query for the server-paginated sales ledger. Mirrors the backend `FilterSalesDTO`. */
export interface SalesListQuery {
  page: number;
  /** Capped at 50 by the backend. */
  limit: number;
  search?: string;
  status?: SaleStatus;
  paymentMethod?: PaymentMethod;
  dateFrom?: string;
  dateTo?: string;
}

/** Display metadata for a payment method: the chip label and its icon. */
export interface PaymentMethodMeta {
  readonly value: PaymentMethod;
  readonly label: string;
  readonly icon: string;
}

/** Payment methods in counter order, Cash first (the default tender). */
export const PAYMENT_METHODS: readonly PaymentMethodMeta[] = [
  { value: 'CASH', label: 'Cash', icon: 'pi pi-money-bill' },
  { value: 'GCASH', label: 'GCash', icon: 'pi pi-mobile' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer', icon: 'pi pi-building' },
];

/** Resolve a payment method's label and icon, falling back to Cash for unknown values. */
export function paymentMethodMeta(method: PaymentMethod): PaymentMethodMeta {
  return PAYMENT_METHODS.find((entry) => entry.value === method) ?? PAYMENT_METHODS[0];
}

/** Display metadata for a sale's status: a non-amber tone, an icon, and a label. */
export interface SaleStatusMeta {
  readonly tone: 'success' | 'danger';
  readonly icon: string;
  readonly label: string;
}

const SALE_STATUS_META: Record<SaleStatus, SaleStatusMeta> = {
  COMPLETED: { tone: 'success', icon: 'pi pi-check-circle', label: 'Completed' },
  VOIDED: { tone: 'danger', icon: 'pi pi-ban', label: 'Voided' },
};

/** Resolve a sale status to its badge metadata. */
export function saleStatusMeta(status: SaleStatus): SaleStatusMeta {
  return SALE_STATUS_META[status] ?? SALE_STATUS_META.COMPLETED;
}

/**
 * Parse a money value (decimal string or number) into integer centavos. POS totals
 * are summed in centavos so repeated float addition never drifts a peso off the
 * backend's authoritative total. Non-finite input yields 0.
 */
export function priceToCents(value: string | number): number {
  const amount = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}
