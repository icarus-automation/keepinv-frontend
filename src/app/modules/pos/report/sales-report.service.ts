import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';

import { PosService } from '../services/pos.service';
import { SaleListItem } from '../types/pos.types';

/** Every sale fetched for a period, plus whether the safety ceiling clipped the range. */
export interface SalesRangeResult {
  sales: SaleListItem[];
  /** True when the period held more pages than we're willing to fetch for a client-side report. */
  truncated: boolean;
}

/**
 * Pulls a whole date range of sales for client-side aggregation. The ledger endpoint
 * is paginated (50/page), so this fetches page one to learn the page count, then the
 * rest in parallel, and concatenates. A page ceiling bounds the work so a huge range
 * can't fan out unbounded; the report surfaces a notice when it bites (it won't at a
 * small shop's volume). A dedicated backend summary endpoint would replace this later.
 */
@Injectable({ providedIn: 'root' })
export class SalesReportService {
  private readonly pos = inject(PosService);

  private static readonly PAGE_LIMIT = 50;
  /** ~3,000 sales. Beyond this, aggregate server-side instead. */
  private static readonly MAX_PAGES = 60;

  loadRange(dateFrom: string, dateTo: string): Observable<SalesRangeResult> {
    const limit = SalesReportService.PAGE_LIMIT;

    return this.pos.listSales({ page: 1, limit, dateFrom, dateTo }).pipe(
      switchMap((first) => {
        const ceiling = SalesReportService.MAX_PAGES;
        const lastPage = Math.min(first.meta.lastPage, ceiling);
        const truncated = first.meta.lastPage > ceiling;

        if (lastPage <= 1) {
          return of({ sales: first.items, truncated });
        }

        const rest: Observable<SaleListItem[]>[] = [];
        for (let page = 2; page <= lastPage; page += 1) {
          rest.push(
            this.pos.listSales({ page, limit, dateFrom, dateTo }).pipe(map((result) => result.items)),
          );
        }

        return forkJoin(rest).pipe(
          map((pages) => ({
            sales: [first.items, ...pages].flat(),
            truncated,
          })),
        );
      }),
    );
  }
}
