import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  ApiResponse,
  PageMeta,
  PaginatedApiResponse,
} from '../../../../common/responses/api.response';
import { Product, ProductListQuery, ProductRequest } from '../types/product.types';

/** A single page of products plus its pagination metadata. */
export interface ProductPage {
  items: Product[];
  meta: PageMeta;
}

/**
 * Talks to the products API. Thin by design: the Bearer token is attached by the
 * global auth interceptor, and the response envelope is unwrapped here so callers
 * only ever see domain types. Unlike the master-data services, the list is
 * server-paginated, so it returns both the page and its `meta`.
 */
@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/products`;

  list(query: ProductListQuery): Observable<ProductPage> {
    let params = new HttpParams()
      .set('page', query.page)
      .set('limit', query.limit);

    const search = query.search?.trim();
    if (search) {
      params = params.set('search', search);
    }
    if (query.categoryId) {
      params = params.set('categoryId', query.categoryId);
    }
    if (query.locationId) {
      params = params.set('locationId', query.locationId);
    }
    if (query.lowStock) {
      params = params.set('lowStock', true);
    }

    return this.http
      .get<PaginatedApiResponse<Product>>(this.baseUrl, { params })
      .pipe(map((response) => ({ items: response.data, meta: response.meta })));
  }

  get(id: string): Observable<Product> {
    return this.http
      .get<ApiResponse<Product>>(`${this.baseUrl}/${id}`)
      .pipe(map((response) => response.data));
  }

  create(body: ProductRequest): Observable<Product> {
    return this.http
      .post<ApiResponse<Product>>(this.baseUrl, body)
      .pipe(map((response) => response.data));
  }

  update(id: string, body: ProductRequest): Observable<Product> {
    return this.http
      .patch<ApiResponse<Product>>(`${this.baseUrl}/${id}`, body)
      .pipe(map((response) => response.data));
  }

  /** Soft delete: the backend exposes no hard-delete endpoint. */
  archive(id: string): Observable<Product> {
    return this.http
      .delete<ApiResponse<Product>>(`${this.baseUrl}/${id}`)
      .pipe(map((response) => response.data));
  }

  /** Upload (or replace) a product's photo. Field name `image`; returns the hydrated product. */
  uploadImage(id: string, file: File): Observable<Product> {
    const form = new FormData();
    form.append('image', file);
    return this.http
      .post<ApiResponse<Product>>(`${this.baseUrl}/${id}/image`, form)
      .pipe(map((response) => response.data));
  }

  /** Remove a product's photo. Returns the product with `imageUrl` cleared. */
  removeImage(id: string): Observable<Product> {
    return this.http
      .delete<ApiResponse<Product>>(`${this.baseUrl}/${id}/image`)
      .pipe(map((response) => response.data));
  }
}
