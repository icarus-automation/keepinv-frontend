import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

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

/** A page of sales plus its pagination metadata. */
export interface SalesPage {
  items: SaleListItem[];
  meta: PageMeta;
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
  private readonly baseUrl = `${environment.apiBaseUrl}/pos`;

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
