import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import { Expense, ExpenseRequest } from '../types/expense.types';

export interface ExpenseFilter {
  expenseCategoryId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Talks to the expenses API. Thin: auth token attached by the interceptor, envelope unwrapped here. */
@Injectable({ providedIn: 'root' })
export class ExpensesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/expenses`;

  list(filter: ExpenseFilter = {}): Observable<Expense[]> {
    let params = new HttpParams();
    if (filter.expenseCategoryId) params = params.set('expenseCategoryId', filter.expenseCategoryId);
    if (filter.dateFrom) params = params.set('dateFrom', filter.dateFrom);
    if (filter.dateTo) params = params.set('dateTo', filter.dateTo);
    return this.http
      .get<ApiResponse<Expense[]>>(this.baseUrl, { params })
      .pipe(map((response) => response.data));
  }

  create(body: ExpenseRequest): Observable<Expense> {
    return this.http.post<ApiResponse<Expense>>(this.baseUrl, body).pipe(map((response) => response.data));
  }

  update(id: string, body: Partial<ExpenseRequest>): Observable<Expense> {
    return this.http
      .patch<ApiResponse<Expense>>(`${this.baseUrl}/${id}`, body)
      .pipe(map((response) => response.data));
  }

  /** Soft delete: the backend exposes no hard-delete endpoint. */
  archive(id: string): Observable<Expense> {
    return this.http
      .delete<ApiResponse<Expense>>(`${this.baseUrl}/${id}`)
      .pipe(map((response) => response.data));
  }
}
