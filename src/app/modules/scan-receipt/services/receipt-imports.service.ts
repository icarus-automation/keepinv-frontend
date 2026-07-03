import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import {
  ReceiptImportCommit,
  ReceiptImportRequest,
  ReceiptScanResult,
} from '../types/receipt-import.types';

/**
 * Talks to the receipt-imports API. Thin by design: the session cookie carries auth
 * and the response envelope is unwrapped here so callers only ever see domain types.
 * Scan holds an Azure OCR analysis for several seconds, so callers must show
 * long-running progress rather than a blocking spinner.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptImportsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/receipt-imports`;

  /** Upload a receipt photo (field name `image`) for OCR + per-line product matching. */
  scan(file: File): Observable<ReceiptScanResult> {
    const form = new FormData();
    form.append('image', file);
    return this.http
      .post<ApiResponse<ReceiptScanResult>>(`${this.baseUrl}/scan`, form)
      .pipe(map((response) => response.data));
  }

  /** Commit the reviewed receipt: creates/matches products and records PURCHASE movements. */
  commit(body: ReceiptImportRequest): Observable<ReceiptImportCommit> {
    return this.http
      .post<ApiResponse<ReceiptImportCommit>>(`${this.baseUrl}/commit`, body)
      .pipe(map((response) => response.data));
  }
}
