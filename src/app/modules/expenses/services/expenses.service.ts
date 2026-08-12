import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import { Expense, ExpenseRequest, RecurringExpense, RecurringExpenseRequest, SuggestedRecurringExpense } from '../types/expense.types';

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

  // --- Fixed / Recurring expenses ---

  listRecurring(): Observable<RecurringExpense[]> {
    return this.http
      .get<ApiResponse<RecurringExpense[]>>(`${this.baseUrl}/recurring`)
      .pipe(map((res) => res.data));
  }

  getRecurringSuggestions(): Observable<SuggestedRecurringExpense[]> {
    return this.http
      .get<ApiResponse<SuggestedRecurringExpense[]>>(`${this.baseUrl}/recurring/suggestions`)
      .pipe(map((res) => res.data));
  }

  postDueRecurring(date?: string): Observable<{ postedCount: number; datesEvaluated: number }> {
    let params = new HttpParams();
    if (date) params = params.set('date', date);
    return this.http
      .post<ApiResponse<{ postedCount: number; datesEvaluated: number }>>(
        `${this.baseUrl}/recurring/post-due`,
        {},
        { params },
      )
      .pipe(map((res) => res.data));
  }

  createRecurring(body: RecurringExpenseRequest): Observable<RecurringExpense> {
    return this.http
      .post<ApiResponse<RecurringExpense>>(`${this.baseUrl}/recurring`, body)
      .pipe(map((res) => res.data));
  }

  updateRecurring(id: string, body: Partial<RecurringExpenseRequest>): Observable<RecurringExpense> {
    return this.http
      .patch<ApiResponse<RecurringExpense>>(`${this.baseUrl}/recurring/${id}`, body)
      .pipe(map((res) => res.data));
  }

  archiveRecurring(id: string): Observable<RecurringExpense> {
    return this.http
      .delete<ApiResponse<RecurringExpense>>(`${this.baseUrl}/recurring/${id}`)
      .pipe(map((res) => res.data));
  }
}
