/** How recording a type changes on-hand stock. Mirrors the backend `StockMovementEffect` enum. */
export type StockMovementEffect = 'INCREASE' | 'DECREASE' | 'ADJUSTMENT';

/**
 * A tenant-configurable label for a kind of stock change ("Purchase", "Sale", or a
 * shop-specific one like "Damaged"). Types with a `systemKey` back fixed workflows
 * (POS sales, returns, imports): the backend forbids changing their effect or
 * archiving them, so the UI presents them as locked.
 */
export interface StockMovementType {
  id: string;
  name: string;
  description: string | null;
  effect: StockMovementEffect;
  /** Stable key for built-in types (e.g. `SALE`). Null for tenant-created types. */
  systemKey: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload to create a movement type. */
export interface CreateStockMovementTypeRequest {
  name: string;
  description?: string;
  effect: StockMovementEffect;
}

/** Payload to update a movement type. `effect` is rejected by the backend for system types. */
export interface UpdateStockMovementTypeRequest {
  name?: string;
  description?: string;
  effect?: StockMovementEffect;
}

/** Whether a type adds to, removes from, or nets out stock — derived from its effect. */
export type MovementDirection = 'in' | 'out' | 'neutral';

/** How an effect reads in the UI: a short phrase, a direction, an icon, and a sign. */
export interface EffectMeta {
  /** Short verb phrase for badges, e.g. "Adds stock". */
  readonly label: string;
  /** Even shorter label for the segmented control, e.g. "Adds". */
  readonly shortLabel: string;
  readonly direction: MovementDirection;
  /** PrimeIcons class. */
  readonly icon: string;
  readonly sign: '+' | '−' | '±';
}

const EFFECT_META: Record<StockMovementEffect, EffectMeta> = {
  INCREASE: {
    label: 'Adds stock',
    shortLabel: 'Adds',
    direction: 'in',
    icon: 'pi pi-arrow-up',
    sign: '+',
  },
  DECREASE: {
    label: 'Removes stock',
    shortLabel: 'Removes',
    direction: 'out',
    icon: 'pi pi-arrow-down',
    sign: '−',
  },
  ADJUSTMENT: {
    label: 'Adjusts stock',
    shortLabel: 'Adjusts',
    direction: 'neutral',
    icon: 'pi pi-sliders-h',
    sign: '±',
  },
};

/** Resolve an effect to its display metadata, tolerating values the enum may add later. */
export function effectMeta(effect: StockMovementEffect): EffectMeta {
  return EFFECT_META[effect] ?? EFFECT_META.ADJUSTMENT;
}

/**
 * Distinct glyphs for the built-in types, keyed by `systemKey`, so each reads on sight
 * (a sale is a bag, a return is a replay) rather than as a generic effect arrow. Custom
 * types carry no system key and fall back to their effect's directional arrow.
 */
const SYSTEM_KEY_ICONS: Record<string, string> = {
  PURCHASE: 'pi pi-shopping-cart',
  SALE: 'pi pi-shopping-bag',
  ADJUSTMENT: 'pi pi-sliders-h',
  RETURN: 'pi pi-replay',
  INITIAL: 'pi pi-flag',
  TRANSFER: 'pi pi-arrow-right-arrow-left',
  DISPOSE: 'pi pi-trash',
};

/** The icon to show for a type: a distinct glyph for built-in types, else the effect arrow. */
export function typeIcon(type: Pick<StockMovementType, 'systemKey' | 'effect'>): string {
  if (type.systemKey && SYSTEM_KEY_ICONS[type.systemKey]) {
    return SYSTEM_KEY_ICONS[type.systemKey];
  }
  return effectMeta(type.effect).icon;
}

/** The three effects in the order the record form and pickers present them. */
export const EFFECT_OPTIONS: readonly StockMovementEffect[] = ['INCREASE', 'DECREASE', 'ADJUSTMENT'];

/**
 * Canonical display order for built-in types by `systemKey`, mirroring the backend so the
 * list keeps its intended order after a local add/edit. Custom types (no systemKey) sort
 * after every built-in, alphabetically.
 */
const SYSTEM_KEY_DISPLAY_ORDER: Record<string, number> = {
  INITIAL: 0,
  PURCHASE: 1,
  SALE: 2,
  ADJUSTMENT: 3,
  TRANSFER: 4,
  RETURN: 5,
  DISPOSE: 6,
};

/** Order comparator: built-ins first in workflow order, then custom types alphabetically. */
export function compareMovementTypes(a: StockMovementType, b: StockMovementType): number {
  const rank = (type: StockMovementType): number => {
    if (type.systemKey === null) return 100;
    return SYSTEM_KEY_DISPLAY_ORDER[type.systemKey] ?? 50;
  };
  const delta = rank(a) - rank(b);
  return delta !== 0 ? delta : a.name.localeCompare(b.name);
}

/** A built-in type (one the backend protects); identified by carrying a `systemKey`. */
export function isSystemType(type: StockMovementType): boolean {
  return type.systemKey !== null;
}

/**
 * Whether a type can be chosen when recording a generic movement. Transfer is reserved: the
 * record payload carries a single location and can't express a source-to-destination move yet.
 * Sale and Return are reserved too: they only carry accurate revenue/refund data when written
 * through Point of Sale checkout/void, which link a sale — recording them here would create
 * inventory movements invisible to the Sales Report.
 */
export function isRecordableType(type: StockMovementType): boolean {
  return (
    !type.isArchived &&
    type.systemKey !== 'TRANSFER' &&
    type.systemKey !== 'SALE' &&
    type.systemKey !== 'RETURN'
  );
}
