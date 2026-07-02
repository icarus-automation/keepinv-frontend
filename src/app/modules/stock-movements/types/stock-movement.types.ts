import { Product } from '../../products/types/product.types';
import { Supplier } from '../../suppliers/types/supplier.types';
import { Location } from '../../locations/types/location.types';
import {
  EffectMeta,
  StockMovementEffect,
  StockMovementType,
  effectMeta,
  typeIcon,
} from '../../stock-movement-types/types/stock-movement-type.types';

/**
 * The pre-migration movement enum. Movements are now recorded against a configurable
 * {@link StockMovementType}; this is retained only to render historical rows captured
 * before the cutover, where `stockMovementType` may be absent.
 */
export type LegacyStockMovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'ADJUSTMENT'
  | 'TRANSFER'
  | 'RETURN'
  | 'INITIAL';

/**
 * The person who recorded a movement. Deliberately narrow: the backend currently
 * embeds the full user (including the password hash); we only ever read identity
 * fields, and the hash must never be referenced or rendered.
 */
export interface MovementUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

/**
 * One immutable entry in the stock ledger. `quantityChange` is signed (positive
 * for stock in, negative for stock out) and `quantityAfter` is the resulting
 * on-hand, both computed by the backend. The movement's kind comes from the
 * embedded `stockMovementType`; related product/supplier/location/user come
 * embedded too.
 */
export interface StockMovement {
  id: string;

  /** The configurable type this movement was recorded under. */
  stockMovementTypeId: string | null;
  stockMovementType: StockMovementType | null;
  /** Pre-cutover enum; only consulted as a display fallback when the type is absent. */
  legacyType?: LegacyStockMovementType | null;

  quantityChange: number;
  quantityAfter: number;
  note: string | null;

  productId: string;
  product: Product;

  productUnitId: string | null;

  locationId: string | null;
  location: Location | null;

  supplierId: string | null;
  supplier: Supplier | null;

  userId: string;
  user: MovementUser;

  createdAt: string;
}

/**
 * Payload to record a movement. `quantity` is always a positive count; the backend
 * derives the signed change and resulting on-hand from the selected type's effect
 * (an ADJUSTMENT type accepts a signed quantity).
 */
export interface StockMovementRequest {
  productId: string;
  stockMovementTypeId: string;
  quantity: number;
  note?: string;
  supplierId?: string | null;
  locationId?: string | null;
}

/** Query for the server-paginated ledger. Mirrors the backend `FilterStockMovementsDTO`. */
export interface StockMovementListQuery {
  page: number;
  /** Capped at 50 by the backend. */
  limit: number;
  productId?: string;
  stockMovementTypeId?: string;
  /** ISO date string (inclusive lower bound). */
  dateFrom?: string;
  /** ISO date string (inclusive upper bound). */
  dateTo?: string;
}

/** Resolved label, icon, and effect metadata for a ledger row, ready to render. */
export interface MovementDisplay {
  readonly name: string;
  readonly effect: StockMovementEffect;
  /** The type's glyph (distinct for built-in types, effect arrow otherwise). */
  readonly icon: string;
  readonly meta: EffectMeta;
}

/** Name + effect for legacy rows whose dynamic type didn't backfill, so they still read correctly. */
const LEGACY_DISPLAY: Record<LegacyStockMovementType, { name: string; effect: StockMovementEffect }> = {
  PURCHASE: { name: 'Purchase', effect: 'INCREASE' },
  SALE: { name: 'Sale', effect: 'DECREASE' },
  RETURN: { name: 'Return', effect: 'INCREASE' },
  INITIAL: { name: 'Initial', effect: 'INCREASE' },
  ADJUSTMENT: { name: 'Adjustment', effect: 'ADJUSTMENT' },
  TRANSFER: { name: 'Transfer', effect: 'ADJUSTMENT' },
};

/**
 * Resolve how a movement should read: its type name and effect metadata. Prefers the
 * embedded dynamic type and falls back to the legacy enum for pre-cutover rows.
 */
export function movementDisplay(
  movement: Pick<StockMovement, 'stockMovementType' | 'legacyType'>,
): MovementDisplay {
  const type = movement.stockMovementType;
  if (type) {
    return { name: type.name, effect: type.effect, icon: typeIcon(type), meta: effectMeta(type.effect) };
  }
  const legacyKey = movement.legacyType ?? null;
  const legacy = legacyKey ? LEGACY_DISPLAY[legacyKey] : null;
  const effect = legacy?.effect ?? 'ADJUSTMENT';
  // Legacy enum values match the system keys, so the same icon map applies to old rows.
  const icon = typeIcon({ systemKey: legacyKey, effect });
  return { name: legacy?.name ?? 'Movement', effect, icon, meta: effectMeta(effect) };
}
