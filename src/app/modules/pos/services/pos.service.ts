import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  ApiResponse,
  PageMeta,
  PaginatedApiResponse,
} from '../../../../common/responses/api.response';
import {
  CheckoutRequest,
  PosSearchItem,
  SaleListItem,
  SaleResult,
  SalesListQuery,
} from '../types/pos.types';
import { ProductsService } from '../../products/services/products.service';
import { Product } from '../../products/types/product.types';

/** A page of sales plus its pagination metadata. */
export interface SalesPage {
  items: SaleListItem[];
  meta: PageMeta;
}

/** How many catalog products to pull per page when hydrating the touch grid. */
const GRID_PAGE_SIZE = 50;

/**
 * A recipe bowl can make as many servings as its scarcest tracked ingredient allows (an untracked
 * ingredient never constrains); an untracked product (a refill) is always sellable; anything else
 * is gated on its own count. Returns `Infinity` for the always-sellable cases so the caller can
 * tell "unlimited" apart from a real zero.
 */
function gridAvailability(product: Product): number {
  if (product.components.length > 0) {
    return product.components.reduce((min, line) => {
      if (!line.component.isStockTracked) {
        return min;
      }
      const servings = Math.floor(line.component.quantityOnHand / Math.max(1, line.quantity));
      return Math.min(min, servings);
    }, Number.POSITIVE_INFINITY);
  }
  if (!product.isStockTracked) {
    return Number.POSITIVE_INFINITY;
  }
  return product.quantityOnHand;
}

/**
 * Map a catalog {@link Product} onto the {@link PosSearchItem} shape the touch grid
 * and cart already share, so a grid tap flows through the exact same `addItem` path
 * as a scan or search pick. Stock-gated: an out-of-stock stock product isn't
 * sellable; serialized products still resolve through the unit picker, which keys
 * off stock too.
 */
function toGridSearchItem(product: Product): PosSearchItem {
  const available = gridAvailability(product);
  const isStockTracked = Number.isFinite(available);

  return {
    kind: 'PRODUCT',
    productId: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    brand: product.brand,
    sellingPrice: product.sellingPrice,
    // Refills and all-untracked recipes have no meaningful count; the grid reads isStockTracked
    // to hide the badge rather than print a placeholder number.
    quantityOnHand: isStockTracked ? available : 0,
    isSerialized: product.isSerialized,
    isSellable: available > 0,
    isStockTracked,
    imageUrl: product.imageUrl,
    categoryName: product.category?.name ?? '',
  };
}

/**
 * Talks to the POS API. Thin by design: the Bearer token is attached by the global
 * auth interceptor, and the response envelope is unwrapped here so callers only see
 * domain types. Search returns a bare list (the scanner needs the fastest possible
 * round trip); the ledger is server-paginated and returns both the page and `meta`.
 */
@Injectable({ providedIn: 'root' })
export class PosService {
  private readonly http = inject(HttpClient);
  private readonly products = inject(ProductsService);
  private readonly baseUrl = `${environment.apiBaseUrl}/pos`;

  /**
   * The whole sellable catalog for the touch grid (lugawjuan): every non-archived
   * stock product, mapped to {@link PosSearchItem}. Pages through the catalog so a
   * menu larger than one page still loads fully, then flattens and maps in one go.
   * Unlike search, this is a bulk fetch — fine for the small menus this grid targets.
   */
  listSellableProducts(): Observable<PosSearchItem[]> {
    return this.products.list({ page: 1, limit: GRID_PAGE_SIZE }).pipe(
      switchMap((first) => {
        if (first.meta.lastPage <= 1) {
          return of(first.items);
        }
        const rest = Array.from({ length: first.meta.lastPage - 1 }, (_, i) =>
          this.products
            .list({ page: i + 2, limit: GRID_PAGE_SIZE })
            .pipe(map((page) => page.items)),
        );
        return forkJoin(rest).pipe(
          map((chunks) => chunks.reduce((all, chunk) => all.concat(chunk), first.items)),
        );
      }),
      map((products) =>
        products
          // Drop archived rows and the shared base pools (stock-only), which aren't sold directly.
          .filter((product) => !product.isArchived && !product.isStockOnly)
          .map(toGridSearchItem),
      ),
    );
  }

  /** Search products and serialized units by name, SKU, barcode, serial, or asset tag. */
  searchItems(search: string, limit = 20): Observable<PosSearchItem[]> {
    const params = new HttpParams().set('search', search).set('limit', limit);
    return this.http
      .get<ApiResponse<PosSearchItem[]>>(`${this.baseUrl}/search-items`, { params })
      .pipe(map((response) => response.data));
  }

  /**
   * List a serialized product's sellable units for the unit picker. The cashier scans
   * the model barcode, then chooses which physical unit leaves the shelf — every sale
   * still maps to a specific serial, so traceability is preserved. Returns `PRODUCT_UNIT`
   * search items so the picker reuses the same row shape as search results.
   */
  listAvailableUnits(productId: string, limit = 50): Observable<PosSearchItem[]> {
    const params = new HttpParams().set('limit', limit);
    return this.http
      .get<ApiResponse<PosSearchItem[]>>(`${this.baseUrl}/products/${productId}/units`, { params })
      .pipe(map((response) => response.data));
  }

  /** Ring up a sale. Returns the persisted sale and its receipt snapshot. */
  checkout(body: CheckoutRequest): Observable<SaleResult> {
    return this.http
      .post<ApiResponse<SaleResult>>(`${this.baseUrl}/checkout`, body)
      .pipe(map((response) => response.data));
  }

  /** A page of the sales ledger. */
  listSales(query: SalesListQuery): Observable<SalesPage> {
    let params = new HttpParams().set('page', query.page).set('limit', query.limit);

    const search = query.search?.trim();
    if (search) {
      params = params.set('search', search);
    }
    if (query.status) {
      params = params.set('status', query.status);
    }
    if (query.paymentMethod) {
      params = params.set('paymentMethod', query.paymentMethod);
    }
    if (query.dateFrom) {
      params = params.set('dateFrom', query.dateFrom);
    }
    if (query.dateTo) {
      params = params.set('dateTo', query.dateTo);
    }

    return this.http
      .get<PaginatedApiResponse<SaleListItem>>(`${this.baseUrl}/sales`, { params })
      .pipe(map((response) => ({ items: response.data, meta: response.meta })));
  }

  /** The full sale (live record + receipt snapshot) for the detail pane. */
  getSale(id: string): Observable<SaleResult> {
    return this.http
      .get<ApiResponse<SaleResult>>(`${this.baseUrl}/sales/${id}`)
      .pipe(map((response) => response.data));
  }

  /** Void a sale, restocking its items. An optional reason is recorded on the sale. */
  voidSale(id: string, reason?: string): Observable<SaleResult> {
    return this.http
      .post<ApiResponse<SaleResult>>(`${this.baseUrl}/sales/${id}/void`, { reason })
      .pipe(map((response) => response.data));
  }
}
