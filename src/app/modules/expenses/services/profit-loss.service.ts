import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import { ProfitLossReport } from '../types/expense.types';

/** Fetches the server-computed profit & loss report for a period. */
@Injectable({ providedIn: 'root' })
export class ProfitLossService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/reports/profit-loss`;

  load(from: string, to: string): Observable<ProfitLossReport> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<ApiResponse<ProfitLossReport>>(this.baseUrl, { params })
      .pipe(map((response) => response.data));
  }
}
