import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import { ConsolidatedReport } from '../types/consolidated.types';

/**
 * Reads the server-computed consolidated cross-store report. Owner/admin only; the backend
 * aggregates the stores the caller owns, so the caller never switches org to build the overview.
 * Same date-window rules as profit-loss (both default to month-to-date when `from`/`to` are omitted).
 */
@Injectable({ providedIn: 'root' })
export class ConsolidatedReportService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/reports/consolidated`;

  load(from: string, to: string): Observable<ConsolidatedReport> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<ApiResponse<ConsolidatedReport>>(this.url, { params })
      .pipe(map((response) => response.data));
  }
}
