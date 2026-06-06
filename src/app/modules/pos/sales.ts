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
  SalesListQuery,
  paymentMethodMeta,
} from './types/pos.types';
import { SaleStatusBadge } from './components/sale-status-badge';
import { SaleDetail } from './detail/sale-detail';

interface SelectOption<T> {
  readonly label: string;
  readonly value: T;
}

/**
 * The sales ledger. Two-pane, mirroring Products: a server-paginated, scanner-
 * searchable table on the left, the selected sale's receipt and void action on the
 * right. Filters map one-to-one to the backend query: free-text across receipt
 * number and item identity, status, payment method, and a completed-date range.
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

    // A range picker emits [from, null] on the first click; wait for both ends (or a
    // full clear) before querying, so picking a start date doesn't fire a premature load.
    this.dateRange.valueChanges
      .pipe(
        filter((range) => range == null || (range[0] != null && range[1] != null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.applyFilters());

    this.load();
  }

  /** See products.ts: the table re-emits onLazyLoad on binding changes; only act on a real page change. */
  protected onLazyLoad(event: TableLazyLoadEvent): void {
    const requestedFirst = event.first ?? 0;
    if (requestedFirst === this.first()) {
      return;
    }
    this.first.set(requestedFirst);
    this.load();
  }

  protected applyFilters(): void {
    this.first.set(0);
    // A new filter may exclude the selected sale; drop it so the detail pane doesn't
    // show a sale that's no longer in the visible ledger.
    this.selected.set(null);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.hasFilters.set(this.computeHasFilters());

    const range = this.dateRange.value;
    const query: SalesListQuery = {
      page: Math.floor(this.first() / this.rows) + 1,
      limit: this.rows,
      search: this.searchControl.value.trim() || undefined,
      status: this.statusControl.value ?? undefined,
      paymentMethod: this.methodControl.value ?? undefined,
      dateFrom: this.startOfDayIso(range?.[0]),
      dateTo: this.endOfDayIso(range?.[1] ?? range?.[0]),
    };

    this.service
      .listSales(query)
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
    this.dateRange.setValue(null, { emitEvent: false });
    this.applyFilters();
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

  /** A void changed a sale; refetch the page so the row's status stays truthful. */
  protected onChanged(): void {
    this.load();
  }

  protected backToList(): void {
    this.paneOpenMobile.set(false);
  }

  protected methodLabel(method: PaymentMethod): string {
    return paymentMethodMeta(method).label;
  }

  protected goToPos(): void {
    void this.router.navigate(['/pos']);
  }

  private computeHasFilters(): boolean {
    return (
      !!this.searchControl.value.trim() ||
      this.statusControl.value !== null ||
      this.methodControl.value !== null ||
      (this.dateRange.value?.some(Boolean) ?? false)
    );
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
