import { Location } from '../../locations/types/location.types';
import { Product } from './product.types';

/**
 * Lifecycle of one physical, serialized unit. Mirrors the backend
 * `ProductUnitStatus`. Three of these count toward `Product.quantityOnHand`
 * (see {@link STOCK_COUNTED_STATUSES}); crossing that line on a status change
 * moves on-hand by one and writes a stock movement.
 */
export type ProductUnitStatus =
  | 'IN_STOCK'
  | 'RESERVED'
  | 'MISPLACED'
  | 'SOLD'
  | 'DAMAGED'
  | 'RETURNED'
  | 'MISSING'
  | 'LOST'
  | 'DISPOSED';

/** Movement reasons the register endpoint accepts (the backend rejects the rest). */
export type RegisterMovementType = 'INITIAL' | 'PURCHASE';

/**
 * One physical unit of a serialized product. The scan anchors live here
 * (`rfidTag`, `assetTag`, `serialNumber`); a unit always carries at least one.
 * `product` and `location` come embedded from the API (`location` is null once a
 * unit is sold or lost).
 */
export interface ProductUnit {
  id: string;
  assetTag: string | null;
  serialNumber: string | null;
  rfidTag: string | null;
  status: ProductUnitStatus;
  productId: string;
  product: Product;
  locationId: string | null;
  location: Location | null;
  createdAt: string;
  updatedAt: string;
}

/** One unit to register. At least one identifier is required by the backend. */
export interface RegisterProductUnitInput {
  assetTag?: string;
  serialNumber?: string;
  rfidTag?: string;
}

/**
 * Bulk-register payload. `locationId` is required; the rest are optional. The
 * call is atomic: it creates the units, increments on-hand, and writes one stock
 * movement per unit.
 */
export interface RegisterProductUnitsRequest {
  productId: string;
  locationId: string;
  stockMovementTypeId?: string;
  supplierId?: string;
  note?: string;
  units: RegisterProductUnitInput[];
}

/** Result of a bulk register: the new units and the product with refreshed on-hand. */
export interface RegisterProductUnitsResult {
  createdCount: number;
  product: Product;
  units: ProductUnit[];
}

/** PATCH body: edit identifiers and/or location. `null` clears a nullable field. */
export interface UpdateProductUnitRequest {
  assetTag?: string | null;
  serialNumber?: string | null;
  rfidTag?: string | null;
  locationId?: string | null;
}

/** Encode (or replace) the RFID/EPC tag on a unit. Blocked on sold/lost units. */
export interface WriteProductUnitTagRequest {
  rfidTag: string;
}

/**
 * Change a unit's status. A location is required when moving *to* a stock-counted
 * status if the unit has none; sold/lost clear the location server-side.
 */
export interface ChangeProductUnitStatusRequest {
  status: ProductUnitStatus;
  locationId?: string;
  note?: string;
}

/** Dispose (soft) of a unit: the backend marks it `DISPOSED` and records a movement. */
export interface RetireProductUnitRequest {
  note?: string;
}

/** Result of a status change or retire: refreshed unit and product on-hand. */
export interface ProductUnitStatusChangeResult {
  product: Product;
  unit: ProductUnit;
}

/** Query for the server-paginated unit list. Mirrors the backend `FilterProductUnitsDTO`. */
export interface ProductUnitListQuery {
  page: number;
  limit: number;
  productId?: string;
  locationId?: string;
  status?: ProductUnitStatus;
  search?: string;
}

/**
 * Statuses that count toward `Product.quantityOnHand`. `MISPLACED` counts (the unit is physically
 * present, just in the wrong spot); the off-hand ones are `SOLD`, `DAMAGED`, `MISSING`, `LOST`,
 * `DISPOSED`. Keep in sync with the backend.
 */
export const STOCK_COUNTED_STATUSES: ReadonlySet<ProductUnitStatus> = new Set<ProductUnitStatus>([
  'IN_STOCK',
  'RESERVED',
  'RETURNED',
  'MISPLACED',
]);

/** Statuses a unit can't keep its RFID tag while in (the tag write is rejected). */
export const TAG_WRITE_BLOCKED_STATUSES: ReadonlySet<ProductUnitStatus> = new Set<ProductUnitStatus>([
  'SOLD',
  'LOST',
  'DISPOSED',
]);

/** Visual + semantic treatment for one status. `tone` keys into the status colour classes. */
export interface ProductUnitStatusMeta {
  readonly status: ProductUnitStatus;
  readonly label: string;
  /** PrimeIcons class. */
  readonly icon: string;
  /** Semantic colour family used for text and /10 tints. Never amber. */
  readonly tone: 'success' | 'danger' | 'info' | 'muted';
  /** Whether a unit in this status is part of on-hand stock. */
  readonly countsOnHand: boolean;
}

/**
 * The full status vocabulary. `LOST` is labelled "Lost" rather than "Retired":
 * the retire *action* produces it, but an audit can too, so the badge stays
 * honest about the state regardless of how it got there.
 */
export const PRODUCT_UNIT_STATUSES: Record<ProductUnitStatus, ProductUnitStatusMeta> = {
  IN_STOCK: { status: 'IN_STOCK', label: 'In stock', icon: 'pi pi-check-circle', tone: 'success', countsOnHand: true },
  RESERVED: { status: 'RESERVED', label: 'Reserved', icon: 'pi pi-bookmark-fill', tone: 'info', countsOnHand: true },
  RETURNED: { status: 'RETURNED', label: 'Returned', icon: 'pi pi-replay', tone: 'info', countsOnHand: true },
  MISPLACED: { status: 'MISPLACED', label: 'Misplaced', icon: 'pi pi-map-marker', tone: 'info', countsOnHand: true },
  DAMAGED: { status: 'DAMAGED', label: 'Damaged', icon: 'pi pi-exclamation-triangle', tone: 'danger', countsOnHand: false },
  MISSING: { status: 'MISSING', label: 'Missing', icon: 'pi pi-question-circle', tone: 'danger', countsOnHand: false },
  SOLD: { status: 'SOLD', label: 'Sold', icon: 'pi pi-shopping-cart', tone: 'muted', countsOnHand: false },
  LOST: { status: 'LOST', label: 'Lost', icon: 'pi pi-ban', tone: 'danger', countsOnHand: false },
  DISPOSED: { status: 'DISPOSED', label: 'Disposed', icon: 'pi pi-trash', tone: 'muted', countsOnHand: false },
};

/** Ordered for filter chips and status pickers: live states first, problems, terminal states last. */
export const PRODUCT_UNIT_STATUS_ORDER: readonly ProductUnitStatus[] = [
  'IN_STOCK',
  'RESERVED',
  'RETURNED',
  'MISPLACED',
  'MISSING',
  'DAMAGED',
  'SOLD',
  'LOST',
  'DISPOSED',
];

export function productUnitStatusMeta(status: ProductUnitStatus): ProductUnitStatusMeta {
  return PRODUCT_UNIT_STATUSES[status];
}

export function statusCountsOnHand(status: ProductUnitStatus): boolean {
  return STOCK_COUNTED_STATUSES.has(status);
}

export function canWriteTag(status: ProductUnitStatus): boolean {
  return !TAG_WRITE_BLOCKED_STATUSES.has(status);
}

/**
 * On-hand delta a status change would cause, mirroring the backend: +1 when a
 * unit re-enters counted stock, -1 when it leaves, 0 within the same group.
 */
export function statusStockDelta(from: ProductUnitStatus, to: ProductUnitStatus): -1 | 0 | 1 {
  const fromCounts = statusCountsOnHand(from);
  const toCounts = statusCountsOnHand(to);
  if (fromCounts === toCounts) {
    return 0;
  }
  return toCounts ? 1 : -1;
}

/** The unit's primary scan anchor for display: RFID first, then serial, then asset. */
export function productUnitIdentifier(unit: Pick<ProductUnit, 'rfidTag' | 'serialNumber' | 'assetTag'>): string {
  return unit.rfidTag ?? unit.serialNumber ?? unit.assetTag ?? '—';
}
