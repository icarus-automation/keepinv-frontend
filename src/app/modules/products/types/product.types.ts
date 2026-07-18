import { Category } from '../../categories/types/category.types';
import {
  Supplier,
  SupplierPlatform,
  detectSupplierPlatform,
} from '../../suppliers/types/supplier.types';
import { Location } from '../../locations/types/location.types';

/** Shown wherever a product has no uploaded photo. Lives in the app's `public/` folder. */
export const PRODUCT_IMAGE_PLACEHOLDER = '/assets/pxl-default-image.png';

/** Image types and size ceiling the photo upload accepts; mirrors the backend's validation. */
export const PRODUCT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * One ingredient a recipe product consumes per unit sold. `quantity` units of `component` are
 * deducted on each sale; `component` carries the ingredient's live count so a bowl's POS
 * availability is the tightest of its ingredients.
 */
export interface ProductComponent {
  quantity: number;
  component: {
    id: string;
    name: string;
    sku: string;
    /** Decimal string; one unit's cost. The recipe editor sums these into a per-serving cost. */
    costPrice: string;
    quantityOnHand: number;
    isStockTracked: boolean;
  };
}

/**
 * A sellable item in the catalog. The core inventory record: identity (name,
 * SKU, barcode, brand), pricing, stock level, and classification.
 *
 * `costPrice` and `sellingPrice` arrive as decimal strings (the backend stores
 * them as `Decimal`); parse with `Number(...)` for math or formatting. The
 * related `category`, `supplier`, and `location` objects come embedded.
 *
 * `quantityOnHand` is read-only here: it only moves through stock movements, so
 * the catalog never lets you type a count directly.
 */
export interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  brand: string | null;
  /**
   * Cloudinary-hosted product photo (optimised delivery URL), or null when none has been uploaded.
   * Shown in the detail pane and the barcode catalog sheet, never in the list. Managed through the
   * dedicated image endpoints, not the create/update payload.
   */
  imageUrl: string | null;
  /** Decimal serialized as a string, e.g. "42850". */
  costPrice: string;
  /** Decimal serialized as a string, e.g. "54990". */
  sellingPrice: string;
  quantityOnHand: number;
  reorderPoint: number | null;
  /**
   * Direct "buy this exact item again" link to the supplier's store page
   * (Shopee/Lazada/Alibaba/...), or null when none is set. Powers the Reorder
   * action; `reorderPlatform` only drives the icon/label shown beside it.
   */
  reorderUrl: string | null;
  reorderPlatform: SupplierPlatform | null;
  isSerialized: boolean;
  isArchived: boolean;

  /**
   * Multi-ingredient recipe. When `components` is non-empty, selling one unit draws down each
   * listed ingredient by its `quantity` (e.g. a bowl deducts 1 cup + 1 egg) rather than this
   * product's own count. `isStockOnly` marks a kitchen ingredient: inventoried, never a POS tile.
   * `isStockTracked` false means the product is always sellable and never decremented (a refill
   * that reuses the cup — it only records the sale). Each component carries its live count so POS
   * availability can be derived.
   */
  isStockOnly: boolean;
  isStockTracked: boolean;
  components: ProductComponent[];

  /**
   * Relation counts embedded by the list/detail endpoints. `componentOf` counts the active menu
   * items that consume this product as an ingredient — the Ingredients page's "used in N items".
   * Absent on bare create/update responses (the catalog re-hydrates after a write).
   */
  _count?: { componentOf: number };

  categoryId: string;
  category: Category;

  supplierId: string | null;
  supplier: Supplier | null;

  locationId: string | null;
  location: Location | null;

  createdAt: string;
  updatedAt: string;
}

/** One recipe line in a write payload: selling one unit consumes `quantity` of `componentId`. */
export interface ProductComponentRequest {
  componentId: string;
  quantity: number;
}

/**
 * Payload for creating or updating a product. Prices are sent as numbers (the
 * API echoes them back as decimal strings). `quantityOnHand` is intentionally
 * absent: opening and adjusting stock happens through stock movements.
 */
export interface ProductRequest {
  name: string;
  sku: string;
  description?: string;
  barcode?: string;
  brand?: string;
  costPrice: number;
  sellingPrice: number;
  reorderPoint?: number | null;
  reorderUrl?: string | null;
  reorderPlatform?: SupplierPlatform | null;
  categoryId: string;
  supplierId?: string | null;
  locationId?: string | null;
  /** Kitchen ingredient: inventoried, never a POS tile. */
  isStockOnly?: boolean;
  /** false = always sellable and never decremented (a refill). */
  isStockTracked?: boolean;
  /** Replace-all recipe: sending the key rewrites the whole recipe; omitting it keeps the current one. */
  components?: ProductComponentRequest[];
}

/** Which half of the catalog to list: kitchen stock or the sellable menu. */
export type ProductKind = 'INGREDIENT' | 'SELLABLE';

/** Query for the server-paginated product list. Mirrors the backend `FilterProductsDTO`. */
export interface ProductListQuery {
  page: number;
  /** Capped at 50 by the backend. */
  limit: number;
  search?: string;
  categoryId?: string;
  locationId?: string;
  lowStock?: boolean;
  kind?: ProductKind;
}

/**
 * Best-guess the reorder platform from the pasted link's host. Alias of the
 * canonical `detectSupplierPlatform` (suppliers own the platform vocabulary) so
 * the reorder-link field and the supplier channel picker never drift apart.
 */
export const detectReorderPlatform = detectSupplierPlatform;

/**
 * A recipe/menu item (e.g. a lugaw bowl): sold in POS, but its stock is derived from the
 * ingredients it consumes, so it is never inventoried or stocked directly. Detected by carrying
 * recipe components. Used to strip stock affordances (on-hand, stock-in, reorder) from these rows.
 */
export function isRecipeProduct(product: Pick<Product, 'components'>): boolean {
  return product.components.length > 0;
}

/**
 * An always-sellable item that is never decremented (e.g. a lugaw refill — the customer reuses the
 * same cup, so the sale is recorded but no stock moves). Has no meaningful on-hand count.
 */
export function isUntrackedProduct(product: Pick<Product, 'isStockTracked'>): boolean {
  return !product.isStockTracked;
}

/**
 * Not inventoried: the product carries no own stock count and can't be stocked. True for recipes
 * (stock comes from ingredients) and untracked items (refills). These are stripped of every stock
 * affordance — no on-hand, no stock-in, no reorder — across the catalog, forms, and picker.
 */
export function isNonStockProduct(
  product: Pick<Product, 'components' | 'isStockTracked'>,
): boolean {
  return isRecipeProduct(product) || isUntrackedProduct(product);
}

/**
 * Internal SKU for a quick-created ingredient, so the client never has to invent one: an ING-
 * prefix, a slug of the name, and a short random suffix. The server's unique constraint is the
 * final guard against the rare clash.
 */
export function generateIngredientSku(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'ITEM';
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ING-${slug}-${suffix}`;
}

/**
 * Usable as a recipe ingredient: active, counts stock, and is not a recipe itself — the checkout
 * deduction walks exactly one level. Mirrors the backend's `validateComponents` rules so the
 * picker never offers something the save would reject.
 */
export function isComponentEligible(
  product: Pick<Product, 'isArchived' | 'isStockTracked' | 'components'>,
): boolean {
  return !product.isArchived && product.isStockTracked && product.components.length === 0;
}

/** Stock standing derived from on-hand vs reorder point. Drives the non-amber warning treatment. */
export type StockState = 'out' | 'low' | 'ok';

/** Resolve a product's stock state. Out beats low; "low" needs a reorder point to compare against. */
export function stockState(product: Pick<Product, 'quantityOnHand' | 'reorderPoint'>): StockState {
  if (product.quantityOnHand <= 0) {
    return 'out';
  }
  if (product.reorderPoint != null && product.quantityOnHand <= product.reorderPoint) {
    return 'low';
  }
  return 'ok';
}
