import { Category } from '../../categories/types/category.types';
import { Supplier, SupplierPlatform } from '../../suppliers/types/supplier.types';
import { Location } from '../../locations/types/location.types';

/** Shown wherever a product has no uploaded photo. Lives in the app's `public/` folder. */
export const PRODUCT_IMAGE_PLACEHOLDER = '/assets/pxl-default-image.png';

/** Image types and size ceiling the photo upload accepts; mirrors the backend's validation. */
export const PRODUCT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

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

  categoryId: string;
  category: Category;

  supplierId: string | null;
  supplier: Supplier | null;

  locationId: string | null;
  location: Location | null;

  createdAt: string;
  updatedAt: string;
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
  isSerialized: boolean;
  categoryId: string;
  supplierId?: string | null;
  locationId?: string | null;
}

/** Query for the server-paginated product list. Mirrors the backend `FilterProductsDTO`. */
export interface ProductListQuery {
  page: number;
  /** Capped at 50 by the backend. */
  limit: number;
  search?: string;
  categoryId?: string;
  locationId?: string;
  lowStock?: boolean;
}

/**
 * Best-guess the reorder platform from the pasted link's host so the operator
 * rarely has to pick it by hand (the fast path stays the correct path). Returns
 * `null` for anything that isn't a parseable http(s) URL, so the picker simply
 * stays empty until the link is valid. A recognised store wins; any other valid
 * URL resolves to `WEBSITE`.
 */
export function detectReorderPlatform(rawUrl: string): SupplierPlatform | null {
  const value = rawUrl.trim();
  if (!value) {
    return null;
  }
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes('shopee')) return 'SHOPEE';
  if (host.includes('lazada')) return 'LAZADA';
  if (host.includes('alibaba') || host.includes('aliexpress') || host.endsWith('1688.com')) return 'ALIBABA';
  if (host === 'm.me' || host.includes('messenger.')) return 'MESSENGER';
  if (host.includes('facebook.') || host === 'fb.com' || host === 'fb.me') return 'FACEBOOK';
  return 'WEBSITE';
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
