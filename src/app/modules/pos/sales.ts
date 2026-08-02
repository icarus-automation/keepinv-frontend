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
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, filter, finalize, merge } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { MoneyPipe } from '../products/utils/money.pipe';
import { PosService } from './services/pos.service';
import {
  PAYMENT_METHODS,
  PaymentMethod,
  SaleListItem,
  SaleStatus,
  SalesFilters,
  SalesSummary,
  paymentMethodMeta,
} from './types/pos.types';
import { SaleStatusBadge } from './components/sale-status-badge';
import { SaleDetail } from './detail/sale-detail';

interface SelectOption<T> {
  readonly label: string;
  readonly value: T;
}

/**
 * The totals band is the only thing on this page that needs `GET /pos/sales/summary`, so it is the
 * first thing to break when the app ships ahead of the API. Both skew symptoms are unactionable at
 * the counter: a 404 when the route is missing, and a 400 when `sales/:id` catches "summary" and its
 * UUID pipe rejects it. Show plain copy rather than leaking "Validation failed (uuid is expected)"
 * onto the shop floor; the ledger below is unaffected either way.
 */
function summaryErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && (error.status === 400 || error.status === 404)) {
    return 'Totals are unavailable right now.';
  }
  return httpErrorMessage(error);
}

/** The two windows staff actually reconcile against: the shift just ended, or last night's. */
type QuickRange = 'today' | 'yesterday';

interface QuickRangeChip {
  readonly value: QuickRange;
  readonly label: string;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * The sales ledger. Two-pane, mirroring Products: a server-paginated, scanner-
 * searchable table on the left, the selected sale's receipt and void action on the
 * right. Filters map one-to-one to the backend query: free-text across receipt
 * number and item identity, status, payment method, and a completed-date range.
 *
 * A totals band sits above the ledger so closing the till doesn't mean adding rows up on a
 * calculator. It comes from `GET /pos/sales/summary` — the whole filtered window, not the ten
 * rows on screen — and splits cash from the rest, because only cash is in the drawer to count.
 */
@Component({
  selector: 'app-sales',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    MoneyPipe,
    ButtonModule,
    InputTextModule,
    SelectModule,
    DatePickerModule,
    TableModule,
    SaleStatusBadge,
    SaleDetail,
  ],
  templateUrl: './sales.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sales {
  private readonly service = inject(PosService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly sales = signal<SaleListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  /** Server page size. The backend caps `limit` at 50; 10 keeps each fetch snappy. */
  protected readonly rows = 10;
  protected readonly first = signal(0);

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly statusControl = new FormControl<SaleStatus | null>(null);
  protected readonly methodControl = new FormControl<PaymentMethod | null>(null);
  /** Range picker value: [from, to]. */
  protected readonly dateRange = new FormControl<Date[] | null>(null);
  /** Mirrors the control (both the calendar and `setDateRange`) so the quick chips can show pressed state. */
  private readonly dateRangeValue = signal<Date[] | null>(null);

  // --- Totals for the filtered window (the remittance figure) ---
  protected readonly summary = signal<SalesSummary | null>(null);
  protected readonly summaryLoading = signal(true);
  protected readonly summaryError = signal<string | null>(null);
  /**
   * The window the loaded totals actually describe, snapshotted on success rather than read live
   * from the controls — a tally must never be captioned with a range whose data hasn't arrived.
   */
  protected readonly summaryWindow = signal('All time');
  /** True when a search/status/payment filter also narrowed the tally, so it isn't the full day. */
  protected readonly summaryNarrowed = signal(false);
  private summaryToken = 0;

  protected readonly quickRanges: readonly QuickRangeChip[] = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
  ];
  /** Which quick chip the current date range corresponds to, for the pressed state. */
  protected readonly activeQuickRange = computed(() => quickRangeOf(this.dateRangeValue()));

  /** Cash is the only tender that lands in the drawer, so it gets its own figure to count against. */
  protected readonly cashTotal = computed(
    () =>
      this.summary()?.byPaymentMethod.find((slice) => slice.paymentMethod === 'CASH')?.amount ??
      '0.00',
  );
  /** Everything banked elsewhere (GCash, transfers) — counted in sales, absent from the drawer. */
  protected readonly nonCashMethods = computed(
    () => this.summary()?.byPaymentMethod.filter((slice) => slice.paymentMethod !== 'CASH') ?? [],
  );

  protected readonly statusOptions: SelectOption<SaleStatus>[] = [
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'Voided', value: 'VOIDED' },
  ];
  protected readonly methodOptions: SelectOption<PaymentMethod>[] = PAYMENT_METHODS.map(
    (method) => ({ label: method.label, value: method.value }),
  );

  protected readonly selected = signal<SaleListItem | null>(null);
  /** On narrow screens the detail replaces the list; this toggles between them. */
  protected readonly paneOpenMobile = signal(false);

  protected readonly hasFilters = signal(false);
  /** No sales at all (not merely filtered to nothing). Drives the first-run empty state. */
  protected readonly isEmptyLedger = computed(
    () => !this.loading() && !this.loadError() && this.total() === 0 && !this.hasFilters(),
  );

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());

    merge(this.statusControl.valueChanges, this.methodControl.valueChanges)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());

    // The calendar writes to the control directly, bypassing `setDateRange`, so mirror every
    // change here too — otherwise a range picked by hand would leave a quick chip stuck pressed.
    this.dateRange.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((range) => this.dateRangeValue.set(range));

    // A range picker emits [from, null] on the first click; wait for both ends (or a
    // full clear) before querying, so picking a start date doesn't fire a premature load.
    this.dateRange.valueChanges
      .pipe(
        filter((range) => range == null || (range[0] != null && range[1] != null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.applyFilters());

    this.reload();
  }

  /** See products.ts: the table re-emits onLazyLoad on binding changes; only act on a real page change. */
  protected onLazyLoad(event: TableLazyLoadEvent): void {
    const requestedFirst = event.first ?? 0;
    if (requestedFirst === this.first()) {
      return;
    }
    this.first.set(requestedFirst);
    // Paging moves through the same filtered window, so the totals still hold — list only.
    this.load();
  }

  protected applyFilters(): void {
    this.first.set(0);
    // A new filter may exclude the selected sale; drop it so the detail pane doesn't
    // show a sale that's no longer in the visible ledger.
    this.selected.set(null);
    this.reload();
  }

  /** Refetch both halves: the rows and the totals that describe them. */
  protected reload(): void {
    this.load();
    this.loadSummary();
  }

  /** Jump the ledger to a single day. Tapping the active chip again clears back to all time. */
  protected setQuickRange(range: QuickRange): void {
    if (this.activeQuickRange() === range) {
      this.setDateRange(null);
      return;
    }
    const day = range === 'today' ? new Date() : addDays(new Date(), -1);
    this.setDateRange([day, day]);
  }

  /**
   * The one writer for the date range, so the picker, the quick chips and the clear button can
   * never disagree about which window is showing. Emitting drives the reload; suppressing it lets
   * a caller that reloads for itself avoid a duplicate fetch.
   */
  private setDateRange(value: Date[] | null, emitEvent = true): void {
    this.dateRangeValue.set(value);
    this.dateRange.setValue(value, { emitEvent });
  }

  /**
   * Totals for every sale the current filters match. Tokened because a fast filter change can
   * land two requests out of order, and a stale tally is worse than none at remittance time.
   */
  protected loadSummary(): void {
    const token = ++this.summaryToken;
    // Captured now so the caption always describes the window this request asked for.
    const window = this.windowLabel();
    const narrowed = this.hasNonDateFilters();

    this.summaryLoading.set(true);
    this.summaryError.set(null);

    this.service
      .salesSummary(this.currentFilters())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          if (token !== this.summaryToken) {
            return;
          }
          this.summary.set(summary);
          this.summaryWindow.set(window);
          this.summaryNarrowed.set(narrowed);
          this.summaryLoading.set(false);
        },
        error: (error: unknown) => {
          if (token !== this.summaryToken) {
            return;
          }
          this.summaryError.set(summaryErrorMessage(error));
          this.summaryLoading.set(false);
        },
      });
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.hasFilters.set(this.computeHasFilters());

    this.service
      .listSales({
        ...this.currentFilters(),
        page: Math.floor(this.first() / this.rows) + 1,
        limit: this.rows,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ({ items, meta }) => {
          this.sales.set(items);
          this.total.set(meta.total);
          // Voiding the last row on a page can leave us past the final page; step back.
          if (!items.length && meta.total > 0 && this.first() > 0) {
            this.first.set(Math.max(0, Math.ceil(meta.total / this.rows) - 1) * this.rows);
            this.load();
            return;
          }
          this.syncSelection(items);
        },
        error: (error: unknown) => this.loadError.set(httpErrorMessage(error)),
      });
  }

  /** Keep the current selection pointed at a fresh row, or open the top sale on desktop. */
  private syncSelection(items: SaleListItem[]): void {
    const current = this.selected();
    if (current) {
      const match = items.find((item) => item.id === current.id);
      this.selected.set(match ?? null);
      return;
    }
    if (items.length) {
      this.selected.set(items[0]);
    }
  }

  protected clearFilters(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.statusControl.setValue(null, { emitEvent: false });
    this.methodControl.setValue(null, { emitEvent: false });
    this.setDateRange(null, false);
    this.applyFilters();
  }

  /** The filters both the ledger page and its totals are read through. */
  private currentFilters(): SalesFilters {
    const range = this.dateRange.value;
    return {
      search: this.searchControl.value.trim() || undefined,
      status: this.statusControl.value ?? undefined,
      paymentMethod: this.methodControl.value ?? undefined,
      dateFrom: this.startOfDayIso(range?.[0]),
      dateTo: this.endOfDayIso(range?.[1] ?? range?.[0]),
    };
  }

  /** Names the summarised window in counter words: "Today", "Yesterday", a date, or a span. */
  private windowLabel(): string {
    const range = this.dateRange.value;
    const from = range?.[0];
    const to = range?.[1] ?? range?.[0];
    if (!from || !to) {
      return 'All time';
    }
    switch (quickRangeOf(range)) {
      case 'today':
        return 'Today';
      case 'yesterday':
        return 'Yesterday';
      default:
        return isSameDay(from, to) ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`;
    }
  }

  /** Filters beyond the date window — these make the tally a subset of the day, not the day. */
  private hasNonDateFilters(): boolean {
    return (
      !!this.searchControl.value.trim() ||
      this.statusControl.value !== null ||
      this.methodControl.value !== null
    );
  }

  protected selectSale(sale: SaleListItem): void {
    this.selected.set(sale);
    this.paneOpenMobile.set(true);
  }

  protected onSelectionChange(sale: SaleListItem | null): void {
    if (sale) {
      this.selectSale(sale);
    }
  }

  /** A void changed a sale; refetch the page and the totals, which the void just moved. */
  protected onChanged(): void {
    this.reload();
  }

  protected backToList(): void {
    this.paneOpenMobile.set(false);
  }

  protected methodLabel(method: PaymentMethod): string {
    return paymentMethodMeta(method).label;
  }

  /** The cashier who rang up a sale (name, or email as a fallback); null when unattributed. */
  protected cashierName(sale: SaleListItem): string | null {
    const cashier = sale.cashier;
    return cashier ? cashier.name?.trim() || cashier.email : null;
  }

  protected goToPos(): void {
    void this.router.navigate(['/pos']);
  }

  private computeHasFilters(): boolean {
    return this.hasNonDateFilters() || (this.dateRange.value?.some(Boolean) ?? false);
  }

  private startOfDayIso(date: Date | null | undefined): string | undefined {
    if (!date) {
      return undefined;
    }
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }

  private endOfDayIso(date: Date | null | undefined): string | undefined {
    if (!date) {
      return undefined;
    }
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }
}

/** Which quick chip a range represents, or null for anything wider than one of those two days. */
function quickRangeOf(range: Date[] | null | undefined): QuickRange | null {
  const from = range?.[0];
  const to = range?.[1];
  if (!from || !to || !isSameDay(from, to)) {
    return null;
  }
  const today = new Date();
  if (isSameDay(from, today)) {
    return 'today';
  }
  return isSameDay(from, addDays(today, -1)) ? 'yesterday' : null;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function shortDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}
