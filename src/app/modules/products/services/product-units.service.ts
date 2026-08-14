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
  ChangeProductUnitStatusRequest,
  LookupProductUnitTagsResult,
  ProductUnit,
  ProductUnitListQuery,
  ProductUnitStatusChangeResult,
  RegisterProductUnitsRequest,
  RegisterProductUnitsResult,
  RetireProductUnitRequest,
  TakenProductUnitTag,
  UpdateProductUnitRequest,
  WriteProductUnitTagRequest,
} from '../types/product-unit.types';

/** A single page of product units plus its pagination metadata. */
export interface ProductUnitPage {
  items: ProductUnit[];
  meta: PageMeta;
}

/**
 * Talks to the product-units API: the serialized side of the catalog. Thin by
 * design, like the other domain services: the Bearer token is attached by the
 * global auth interceptor and the response envelope is unwrapped here. Register,
 * status change, and retire are atomic server-side and echo back the product with
 * a refreshed `quantityOnHand`, so callers can keep on-hand truthful without a
 * second fetch.
 */
@Injectable({ providedIn: 'root' })
export class ProductUnitsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/product-units`;

  list(query: ProductUnitListQuery): Observable<ProductUnitPage> {
    let params = new HttpParams().set('page', query.page).set('limit', query.limit);

    if (query.productId) {
      params = params.set('productId', query.productId);
    }
    if (query.locationId) {
      params = params.set('locationId', query.locationId);
    }
    if (query.status) {
      params = params.set('status', query.status);
    }
    const search = query.search?.trim();
    if (search) {
      params = params.set('search', search);
    }

    return this.http
      .get<PaginatedApiResponse<ProductUnit>>(this.baseUrl, { params })
      .pipe(map((response) => ({ items: response.data, meta: response.meta })));
  }

  get(id: string): Observable<ProductUnit> {
    return this.http
      .get<ApiResponse<ProductUnit>>(`${this.baseUrl}/${id}`)
      .pipe(map((response) => response.data));
  }

  /** Bulk-register units for a serialized product. Atomic; increments on-hand. */
  register(body: RegisterProductUnitsRequest): Observable<RegisterProductUnitsResult> {
    return this.http
      .post<ApiResponse<RegisterProductUnitsResult>>(`${this.baseUrl}/register`, body)
      .pipe(map((response) => response.data));
  }

  /**
   * Ask which of these scanned identifiers the catalog already owns. Read-only; used by the
   * commissioning sweep so already-registered stock is flagged in the roster instead of failing
   * the whole batch at register time.
   */
  lookupTags(tags: string[]): Observable<TakenProductUnitTag[]> {
    return this.http
      .post<ApiResponse<LookupProductUnitTagsResult>>(`${this.baseUrl}/lookup-tags`, { tags })
      .pipe(map((response) => response.data.taken));
  }

  /** Edit a unit's identifiers and/or location. */
  update(id: string, body: UpdateProductUnitRequest): Observable<ProductUnit> {
    return this.http
      .patch<ApiResponse<ProductUnit>>(`${this.baseUrl}/${id}`, body)
      .pipe(map((response) => response.data));
  }

  /** Encode (or replace) the RFID/EPC tag on a unit. Rejected for sold/lost units. */
  writeTag(id: string, body: WriteProductUnitTagRequest): Observable<ProductUnit> {
    return this.http
      .post<ApiResponse<ProductUnit>>(`${this.baseUrl}/${id}/write-tag`, body)
      .pipe(map((response) => response.data));
  }

  /** Move a unit to a new status; may shift on-hand and record a movement. */
  changeStatus(
    id: string,
    body: ChangeProductUnitStatusRequest,
  ): Observable<ProductUnitStatusChangeResult> {
    return this.http
      .post<ApiResponse<ProductUnitStatusChangeResult>>(`${this.baseUrl}/${id}/status`, body)
      .pipe(map((response) => response.data));
  }

  /** Retire a unit (soft): the backend marks it lost and decrements on-hand. */
  retire(id: string, body: RetireProductUnitRequest = {}): Observable<ProductUnitStatusChangeResult> {
    return this.http
      .delete<ApiResponse<ProductUnitStatusChangeResult>>(`${this.baseUrl}/${id}`, { body })
      .pipe(map((response) => response.data));
  }
}
