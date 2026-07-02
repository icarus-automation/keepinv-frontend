import { ProductUnitStatus } from '../../products/types/product-unit.types';

/** One unit shown in a "needs attention" preview list. Mirrors the backend `AttentionUnit`. */
export interface AttentionUnit {
  id: string;
  productName: string;
  productSku: string;
  /** rfidTag, else serialNumber, else assetTag. */
  identifier: string | null;
  locationName: string | null;
  status: ProductUnitStatus;
}

export interface AttentionBucket {
  count: number;
  units: AttentionUnit[];
}

/**
 * The inventory dashboard payload from `GET /reports/inventory-dashboard`. One consistent snapshot:
 * stock KPIs, the unit-status breakdown, assets by category and location, and the buckets that need
 * chasing down (missing / misplaced / untagged / disposed).
 */
export interface InventoryDashboardReport {
  generatedAt: string;
  totals: {
    productCount: number;
    trackedUnitCount: number;
    stockValue: number;
    lowStockCount: number;
  };
  unitStatus: { status: ProductUnitStatus; count: number }[];
  byCategory: { categoryId: string; categoryName: string; quantity: number; productCount: number }[];
  byLocation: { locationId: string | null; locationName: string; quantity: number }[];
  attention: {
    missing: AttentionBucket;
    misplaced: AttentionBucket;
    untagged: AttentionBucket;
    disposedCount: number;
  };
}
