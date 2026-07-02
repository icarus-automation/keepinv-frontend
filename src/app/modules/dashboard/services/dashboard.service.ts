import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import { InventoryDashboardReport } from '../types/dashboard.types';

/**
 * Reads the inventory dashboard report. The server does all the aggregation in one tenant-scoped
 * snapshot; this just unwraps the response envelope (the Bearer token is added by the global auth
 * interceptor).
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/reports`;

  getInventoryDashboard(): Observable<InventoryDashboardReport> {
    return this.http
      .get<ApiResponse<InventoryDashboardReport>>(`${this.baseUrl}/inventory-dashboard`)
      .pipe(map((response) => response.data));
  }
}
