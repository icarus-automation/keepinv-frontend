import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import { ExpenseCategory, ExpenseCategoryRequest } from '../types/expense.types';

/** Talks to the expense-categories API. Mirrors CategoriesService. */
@Injectable({ providedIn: 'root' })
export class ExpenseCategoriesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/expense-categories`;

  list(): Observable<ExpenseCategory[]> {
    return this.http
      .get<ApiResponse<ExpenseCategory[]>>(this.baseUrl)
      .pipe(map((response) => response.data));
  }

  create(body: ExpenseCategoryRequest): Observable<ExpenseCategory> {
    return this.http
      .post<ApiResponse<ExpenseCategory>>(this.baseUrl, body)
      .pipe(map((response) => response.data));
  }

  update(id: string, body: ExpenseCategoryRequest): Observable<ExpenseCategory> {
    return this.http
      .patch<ApiResponse<ExpenseCategory>>(`${this.baseUrl}/${id}`, body)
      .pipe(map((response) => response.data));
  }

  archive(id: string): Observable<ExpenseCategory> {
    return this.http
      .delete<ApiResponse<ExpenseCategory>>(`${this.baseUrl}/${id}`)
      .pipe(map((response) => response.data));
  }
}
