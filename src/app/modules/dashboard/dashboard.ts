import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, map, of } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { ChartModule } from 'primeng/chart';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { EntitlementsService } from '../../../common/entitlements/entitlements.service';
import { MoneyPipe, formatPeso } from '../products/utils/money.pipe';
import { ProductUnitStatusBadge } from '../products/units/product-unit-status-badge';
import { ProductsService } from '../products/services/products.service';
import { Product } from '../products/types/product.types';
import { SalesReportService } from '../pos/report/sales-report.service';
import { ReportSummary, summarizeSales } from '../pos/report/report.types';
import { ProfitLossService } from '../expenses/services/profit-loss.service';
import { ProfitLossReport } from '../expenses/types/expense.types';
import { DashboardService } from './services/dashboard.service';
import { AttentionBucket, InventoryDashboardReport } from './types/dashboard.types';

interface AttentionTile {
  readonly label: string;
  readonly count: number;
  /** Full colour class, e.g. `text-danger`. Never amber (that stays the one signal). */
  readonly tone: string;
  readonly icon: string;
}

interface AttentionList {
  readonly key: string;
  readonly label: string;
  readonly emptyHint: string;
  readonly bucket: AttentionBucket;
}

/** A labelled quantity row for the by-category / by-location bar lists. */
interface DistributionRow {
  readonly label: string;
  readonly quantity: number;
  readonly sublabel?: string;
}

// Chart colours picked to sit with the warm "Lit Workbench" palette. Kept as explicit values so the
// canvas renders consistently across browsers (rather than resolving CSS custom properties at runtime).
const CHART_SIGNAL = '#c88a2e';
const DOUGHNUT_PALETTE = [
  '#c88a2e', '#3f8f5f', '#4a6fb0', '#b0553a', '#7d9b4e', '#9b6f4e', '#5f8f8f', '#8a8175',
];
const AXIS_MUTED = '#8a8175';
const LEGEND_INK = '#403a30';

/** Human labels for the unit-status doughnut. Mirrors the ProductUnitStatus enum. */
const UNIT_STATUS_LABELS: Record<string, string> = {
  IN_STOCK: 'In stock',
  RESERVED: 'Reserved',
  MISPLACED: 'Misplaced',
  SOLD: 'Sold',
  DAMAGED: 'Damaged',
  RETURNED: 'Returned',
  MISSING: 'Missing',
  LOST: 'Lost',
  DISPOSED: 'Disposed',
};

/**
 * The dashboard: the operator's first read on the shop. Inventory health (stock KPIs, what needs
 * chasing, assets by category/location) plus — for POS tenants — a business pulse: a 7-day revenue
 * trend, payment mix, month-to-date P&L, and a reorder shortcut for low stock. Everything comes from
 * server snapshots; this component renders and shapes the chart data.
 */
@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink, ButtonModule, ChartModule, MoneyPipe, ProductUnitStatusBadge],
  templateUrl: './dashboard.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly dashboardService = inject(DashboardService);
  private readonly salesReport = inject(SalesReportService);
  private readonly profitLoss = inject(ProfitLossService);
  private readonly productsService = inject(ProductsService);
  private readonly entitlements = inject(EntitlementsService);
  private readonly destroyRef = inject(DestroyRef);

  /** POS-tier only: revenue, payment mix, and P&L need sales data BASIC tenants don't have. */
  protected readonly canUsePos = this.entitlements.canUsePos;

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly report = signal<InventoryDashboardReport | null>(null);

  /** Last-7-days sales rollup and month-to-date P&L; null when not loaded or POS is off. */
  protected readonly salesSummary = signal<ReportSummary | null>(null);
  protected readonly pnl = signal<ProfitLossReport | null>(null);
  /** Products at or below their reorder point, for the reorder shortcut list. */
  protected readonly lowStockProducts = signal<Product[]>([]);

  /** No products at all: a first-run shop, not a load failure — teach instead of showing zeros. */
  protected readonly isEmpty = computed(() => {
    const report = this.report();
    return !this.loading() && !this.loadError() && report !== null && report.totals.productCount === 0;
  });

  protected readonly attentionTiles = computed<AttentionTile[]>(() => {
    const attention = this.report()?.attention;
    if (!attention) return [];
    return [
      { label: 'Missing', count: attention.missing.count, tone: 'text-danger', icon: 'pi pi-question-circle' },
      { label: 'Misplaced', count: attention.misplaced.count, tone: 'text-info', icon: 'pi pi-map-marker' },
      { label: 'Without RFID', count: attention.untagged.count, tone: 'text-muted', icon: 'pi pi-tag' },
      { label: 'Disposed', count: attention.disposedCount, tone: 'text-muted', icon: 'pi pi-trash' },
    ];
  });

  /** Only the preview lists that actually have units to show. */
  protected readonly attentionLists = computed<AttentionList[]>(() => {
    const attention = this.report()?.attention;
    if (!attention) return [];
    const lists: AttentionList[] = [
      { key: 'missing', label: 'Missing', emptyHint: '', bucket: attention.missing },
      { key: 'misplaced', label: 'Misplaced', emptyHint: '', bucket: attention.misplaced },
      { key: 'untagged', label: 'Without RFID tag', emptyHint: '', bucket: attention.untagged },
    ];
    return lists.filter((list) => list.bucket.count > 0);
  });

  /** True once everything the count tracks is accounted for — nothing missing, misplaced, or untagged. */
  protected readonly allClear = computed(() => {
    const attention = this.report()?.attention;
    return (
      attention !== undefined &&
      attention.missing.count === 0 &&
      attention.misplaced.count === 0 &&
      attention.untagged.count === 0
    );
  });

  protected readonly categoryRows = computed<DistributionRow[]>(() =>
    (this.report()?.byCategory ?? []).map((row) => ({
      label: row.categoryName,
      quantity: row.quantity,
      sublabel: `${row.productCount} product${row.productCount === 1 ? '' : 's'}`,
    })),
  );

  protected readonly locationRows = computed<DistributionRow[]>(() =>
    (this.report()?.byLocation ?? []).map((row) => ({
      label: row.locationName,
      quantity: row.quantity,
    })),
  );

  private readonly maxCategoryQuantity = computed(() =>
    Math.max(0, ...this.categoryRows().map((row) => row.quantity)),
  );
  private readonly maxLocationQuantity = computed(() =>
    Math.max(0, ...this.locationRows().map((row) => row.quantity)),
  );

  /** Non-empty unit-status slices for the doughnut and its screen-reader table. */
  protected readonly unitStatusRows = computed(() =>
    (this.report()?.unitStatus ?? [])
      .filter((row) => row.count > 0)
      .map((row) => ({ label: UNIT_STATUS_LABELS[row.status] ?? row.status, count: row.count })),
  );

  protected readonly revenueTrendData = computed(() => {
    const summary = this.salesSummary();
    if (!summary || summary.trend.length === 0) return null;
    return {
      labels: summary.trend.map((bucket) => bucket.label),
      datasets: [
        {
          label: 'Revenue',
          data: summary.trend.map((bucket) => bucket.revenueCents / 100),
          borderColor: CHART_SIGNAL,
          backgroundColor: 'rgba(200, 138, 46, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: CHART_SIGNAL,
        },
      ],
    };
  });

  protected readonly paymentMixData = computed(() => {
    const summary = this.salesSummary();
    if (!summary || summary.payments.length === 0) return null;
    return {
      labels: summary.payments.map((slice) => slice.label),
      datasets: [
        {
          data: summary.payments.map((slice) => slice.amountCents / 100),
          backgroundColor: DOUGHNUT_PALETTE,
          borderWidth: 0,
        },
      ],
    };
  });

  protected readonly unitStatusData = computed(() => {
    const rows = this.unitStatusRows();
    if (rows.length === 0) return null;
    return {
      labels: rows.map((row) => row.label),
      datasets: [{ data: rows.map((row) => row.count), backgroundColor: DOUGHNUT_PALETTE, borderWidth: 0 }],
    };
  });

  protected readonly lineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
    scales: {
      x: { grid: { display: false }, ticks: { color: AXIS_MUTED } },
      y: { beginAtZero: true, grid: { color: 'rgba(64, 58, 48, 0.08)' }, ticks: { color: AXIS_MUTED } },
    },
  };

  protected readonly doughnutChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { color: LEGEND_INK, boxWidth: 12, padding: 12 } },
    },
  };

  constructor() {
    this.load();
  }

  protected refresh(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    const canPos = this.canUsePos();
    const now = new Date();
    const weekStart = this.startOfDay(this.addDays(now, -6));
    const to = this.endOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    forkJoin({
      report: this.dashboardService.getInventoryDashboard(),
      lowStock: this.productsService
        .list({ page: 1, limit: 6, lowStock: true })
        .pipe(
          map((page) => page.items),
          catchError(() => of<Product[]>([])),
        ),
      sales: canPos
        ? this.salesReport.loadRange(weekStart.toISOString(), to.toISOString()).pipe(
            map((result) => summarizeSales(result.sales, weekStart, to, 'day')),
            catchError(() => of<ReportSummary | null>(null)),
          )
        : of<ReportSummary | null>(null),
      pnl: canPos
        ? this.profitLoss
            .load(monthStart.toISOString(), to.toISOString())
            .pipe(catchError(() => of<ProfitLossReport | null>(null)))
        : of<ProfitLossReport | null>(null),
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ({ report, lowStock, sales, pnl }) => {
          this.report.set(report);
          this.lowStockProducts.set(lowStock);
          this.salesSummary.set(sales);
          this.pnl.set(pnl);
        },
        error: (error: unknown) => this.loadError.set(httpErrorMessage(error)),
      });
  }

  protected categoryBarWidth(quantity: number): number {
    return this.barWidth(quantity, this.maxCategoryQuantity());
  }

  protected locationBarWidth(quantity: number): number {
    return this.barWidth(quantity, this.maxLocationQuantity());
  }

  /** Bar width as a percentage of the largest row, with a visible floor for any non-zero value. */
  private barWidth(quantity: number, max: number): number {
    if (quantity <= 0 || max <= 0) return 0;
    return Math.max(4, (quantity / max) * 100);
  }

  protected peso(cents: number): string {
    return formatPeso(cents / 100);
  }

  private startOfDay(date: Date): Date {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private endOfDay(date: Date): Date {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end;
  }

  private addDays(date: Date, days: number): Date {
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() + days);
    return shifted;
  }
}
