/**
 * Frontend mirror of the backend menu contract (`/menu`). A group is one drink line the customer
 * orders by size then flavor: its `products` are the sizes (priced, stocked, edited on the Menu
 * Items screen) and its `flavors` are options that hold no stock at all.
 */

/** A size attached to a group, as returned inside a group payload. */
export interface MenuGroupSize {
  id: string;
  name: string;
  sku: string;
  /** Decimal string, e.g. "39.00". */
  sellingPrice: string;
  menuSizeLabel: string | null;
  menuSortOrder: number;
}

export interface MenuFlavor {
  id: string;
  name: string;
  sortOrder: number;
  /** Decimal string added to whichever size is picked, e.g. "10.00". */
  priceDelta: string;
  /** The counter's sold-out toggle. Archiving retires a flavor for good; this only pauses it. */
  isAvailable: boolean;
  isArchived: boolean;
  menuGroupId: string;
}

export interface MenuGroup {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isArchived: boolean;
  flavors: MenuFlavor[];
  products: MenuGroupSize[];
}

/** Body for creating or patching a group. */
export interface MenuGroupRequest {
  name?: string;
  description?: string;
  sortOrder?: number;
}

/** Body for creating or patching a flavor. `priceDelta` is a number with at most 2 decimals. */
export interface MenuFlavorRequest {
  name?: string;
  priceDelta?: number;
  isAvailable?: boolean;
  sortOrder?: number;
}
