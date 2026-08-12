import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../../../common/responses/api.response';
import { SalesDayReportData, InventoryReportData } from '../../../common/printing/receipt/receipt-slips';

@Injectable({ providedIn: 'root' })
export class EndOfDayService {
  private readonly http = inject(HttpClient);

  getSalesDayReport(date?: string): Observable<SalesDayReportData> {
    let params = new HttpParams();
    if (date) params = params.set('date', date);
    return this.http
      .get<ApiResponse<SalesDayReportData>>(`${environment.apiBaseUrl}/pos/sales/day-report`, { params })
      .pipe(map((res) => res.data));
  }

  getInventoryCloseReport(date?: string): Observable<InventoryReportData> {
    let params = new HttpParams();
    if (date) params = params.set('date', date);
    return this.http
      .get<ApiResponse<InventoryReportData>>(`${environment.apiBaseUrl}/reports/inventory-close`, { params })
      .pipe(map((res) => res.data));
  }
}
