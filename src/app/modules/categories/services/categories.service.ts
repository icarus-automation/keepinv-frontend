import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import { Category, CategoryRequest } from '../types/category.types';

/**
 * Talks to the categories API. Thin by design: the Bearer token is attached by
 * the global auth interceptor, and the response envelope is unwrapped here so
 * callers only ever see domain types.
 */
@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/categories`;

  list(): Observable<Category[]> {
    return this.http.get<ApiResponse<Category[]>>(this.baseUrl).pipe(map((response) => response.data));
  }

  create(body: CategoryRequest): Observable<Category> {
    return this.http.post<ApiResponse<Category>>(this.baseUrl, body).pipe(map((response) => response.data));
  }

  update(id: string, body: CategoryRequest): Observable<Category> {
    return this.http
      .patch<ApiResponse<Category>>(`${this.baseUrl}/${id}`, body)
      .pipe(map((response) => response.data));
  }

  /** Soft delete: the backend exposes no hard-delete endpoint. */
  archive(id: string): Observable<Category> {
    return this.http
      .delete<ApiResponse<Category>>(`${this.baseUrl}/${id}`, {})
      .pipe(map((response) => response.data));
  }
}
