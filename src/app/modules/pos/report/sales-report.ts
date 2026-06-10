import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { filter } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';

import { httpErrorMessage } from '../../../../common/http/http-error-message';
import { MoneyPipe, formatPeso } from '../../products/utils/money.pipe';
import { PaymentMethod, SaleListItem, paymentMethodMeta } from '../types/pos.types';
import { SalesReportService } from './sales-report.service';
import {
  ReportPeriod,
  ReportSummary,
  TrendBucket,
  TrendGranularity,
  summarizeSales,
} from './report.types';
import { SaleStatusBadge } from '../components/sale-status-badge';

interface PeriodChip {
  readonly value: ReportPeriod;
  readonly label: string;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * The sales report: a calm, glanceable read of how the shop is doing over a chosen
 * window, built for an owner checking in from away. It aggregates the paginated sales
 * ledger client-side (revenue, volume, payment mix, voids, a revenue trend, recent
 * activity), so it ships without a backend summary endpoint. Revenue counts COMPLETED
 * sales only; voids are reported apart.
 */
@Component({
  selector: 'app-sales-report',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    RouterLink,
    MoneyPipe,
    ButtonModule,
    DatePickerModule,
    SaleStatusBadge,
  ],
  templateUrl: './sales-report.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SalesReport {
  private readonly reportService = inject(SalesReportService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly periods: readonly PeriodChip[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: 'custom', label: 'Custom' },
  ];
  protected readonly period = signal<ReportPeriod>('today');
  protected readonly customRange = new FormControl<Date[] | null>(null);
  private readonly customRangeValue = toSignal(this.customRange.valueChanges, {
    initialValue: this.customRange.value,
  });

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly truncated = signal(false);
  protected readonly asOf = signal<Date | null>(null);

  private readonly rawSales = signal<SaleListItem[]>([]);
  private readonly loadedFrom = signal<Date>(new Date());
  private readonly loadedTo = signal<Date>(new Date());
  private readonly loadedGranularity = signal<TrendGranularity>('hour');
  private loadToken = 0;

  protected readonly summary = computed<ReportSummary>(() =>
    summarizeSales(this.rawSales(), this.loadedFrom(), this.loadedTo(), this.loadedGranularity()),
  );
  protected readonly recentSales = computed(() =>
    [...this.rawSales()]
      .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
      .slice(0, 6),
  );
  protected readonly isEmpty = computed(
    () => !this.loading() && !this.loadError() && this.rawSales().length === 0,
  );
  /** Custom is selected but no full range is chosen yet: prompt for one instead of an empty read. */
  protected readonly awaitingCustomRange = computed(() => {
    const range = this.customRangeValue();
    return this.period() === 'custom' && !(range?.[0] && range?.[1]);
  });

  protected readonly granularityLabel = computed(() =>
    this.loadedGranularity() === 'hour' ? 'hour' : 'day',
  );

  protected readonly periodLabel = computed(() => {
    switch (this.period()) {
      case 'today':
        return 'Today';
      case '7d':
        return 'Last 7 days';
      case '30d':
        return 'Last 30 days';
      default:
        return `${this.shortDate(this.loadedFrom())} – ${this.shortDate(this.loadedTo())}`;
    }
  });

  constructor() {
    // Picking a full range switches to the custom period and loads it.
    this.customRange.valueChanges
      .pipe(
        filter((range) => range != null && range[0] != null && range[1] != null),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.period.set('custom');
        this.load();
      });

    this.load();
  }

  protected setPeriod(period: ReportPeriod): void {
    this.period.set(period);
    if (period !== 'custom' || this.hasCustomRange()) {
      this.load();
    }
  }

  protected refresh(): void {
    this.load();
  }

  protected load(): void {
    const range = this.periodRange();
    if (!range) {
      // Custom period with no range chosen yet: nothing to fetch.
      this.loading.set(false);
      return;
    }

    const token = ++this.loadToken;
    const granularity: TrendGranularity = this.sameDay(range.from, range.to) ? 'hour' : 'day';
    this.loading.set(true);
    this.loadError.set(null);

    this.reportService
      .loadRange(range.from.toISOString(), range.to.toISOString())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ sales, truncated }) => {
          if (token !== this.loadToken) {
            return;
          }
          this.rawSales.set(sales);
          this.truncated.set(truncated);
          this.loadedFrom.set(range.from);
          this.loadedTo.set(range.to);
          this.loadedGranularity.set(granularity);
          this.asOf.set(new Date());
          this.loading.set(false);
        },
        error: (error: unknown) => {
          if (token !== this.loadToken) {
            return;
          }
          this.loadError.set(httpErrorMessage(error));
          this.loading.set(false);
        },
      });
  }

  /** Bar height as a percentage of the period's peak, with a visible floor for non-zero days. */
  protected barHeight(bucket: TrendBucket): number {
    if (bucket.revenueCents === 0) {
      return 0;
    }
    return Math.max(4, (bucket.revenueCents / this.summary().maxBucketCents) * 100);
  }

  protected peso(cents: number): string {
    return formatPeso(cents / 100);
  }

  protected methodLabel(method: PaymentMethod): string {
    return paymentMethodMeta(method).label;
  }

  /** Thin out axis labels when there are many bars, so day numbers don't overlap. */
  protected showLabel(index: number): boolean {
    const count = this.summary().trend.length;
    if (count <= 14) {
      return true;
    }
    return index % Math.ceil(count / 10) === 0;
  }

  private hasCustomRange(): boolean {
    const range = this.customRange.value;
    return range != null && range[0] != null && range[1] != null;
  }

  private periodRange(): { from: Date; to: Date } | null {
    const now = new Date();
    switch (this.period()) {
      case 'today':
        return { from: this.startOfDay(now), to: this.endOfDay(now) };
      case '7d':
        return { from: this.startOfDay(this.addDays(now, -6)), to: this.endOfDay(now) };
      case '30d':
        return { from: this.startOfDay(this.addDays(now, -29)), to: this.endOfDay(now) };
      default: {
        const range = this.customRange.value;
        if (!range || !range[0] || !range[1]) {
          return null;
        }
        return { from: this.startOfDay(range[0]), to: this.endOfDay(range[1]) };
      }
    }
  }

  private sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
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

  private shortDate(date: Date): string {
    return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  }
}
