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
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter, finalize, forkJoin } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { Popover, PopoverModule } from 'primeng/popover';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { MoneyPipe } from '../products/utils/money.pipe';
import { ExpensesService } from './services/expenses.service';
import { ExpenseCategoriesService } from './services/expense-categories.service';
import { ProfitLossService } from './services/profit-loss.service';
import { Expense, ExpenseCategory, ProfitLossReport } from './types/expense.types';

/** A preset reporting window, or a custom date range. */
type ExpensePeriod = 'today' | '7d' | '30d' | 'mtd' | 'custom';

interface PeriodChip {
  readonly value: ExpensePeriod;
  readonly label: string;
}

/**
 * Expenses + profit/loss. Records operating costs and, for the chosen period, shows a P&L that nets
 * POS revenue and cost-of-goods against expenses — plus a margin breakdown by category and product.
 */
@Component({
  selector: 'app-expenses',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    MoneyPipe,
    ButtonModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    DatePickerModule,
    PopoverModule,
  ],
  templateUrl: './expenses.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Expenses {
  private readonly formBuilder = inject(FormBuilder);
  private readonly expensesService = inject(ExpensesService);
  private readonly categoriesService = inject(ExpenseCategoriesService);
  private readonly profitLoss = inject(ProfitLossService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly periods: readonly PeriodChip[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: 'mtd', label: 'This month' },
    { value: 'custom', label: 'Custom' },
  ];
  protected readonly period = signal<ExpensePeriod>('mtd');
  protected readonly customRange = new FormControl<Date[] | null>(null);

  /** Latest date the datepicker allows — an expense can't be incurred in the future. */
  protected readonly today = new Date();

  protected readonly expenses = signal<Expense[]>([]);
  protected readonly categories = signal<ExpenseCategory[]>([]);
  protected readonly pnl = signal<ProfitLossReport | null>(null);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly categoryOptions = computed(() =>
    this.categories().map((category) => ({ id: category.id, name: category.name })),
  );
  protected readonly isEmpty = computed(
    () => !this.loading() && !this.loadError() && this.expenses().length === 0,
  );

  protected readonly editingId = signal<string | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    expenseCategoryId: this.formBuilder.control<string | null>(null, [Validators.required]),
    amount: this.formBuilder.control<number | null>(null, [Validators.required, Validators.min(0.01)]),
    incurredAt: this.formBuilder.control<Date | null>(new Date(), [Validators.required]),
    note: ['', [Validators.maxLength(500)]],
  });
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly quickCategoryName = new FormControl('', { nonNullable: true });
  protected readonly quickBusy = signal(false);
  protected readonly quickError = signal<string | null>(null);

  protected readonly archivingId = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);

  constructor() {
    this.categoriesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (items) => this.categories.set(items) });

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

  protected setPeriod(period: ExpensePeriod): void {
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
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);

    const from = range.from.toISOString();
    const to = range.to.toISOString();
    forkJoin({
      expenses: this.expensesService.list({ dateFrom: from, dateTo: to }),
      pnl: this.profitLoss.load(from, to),
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ({ expenses, pnl }) => {
          this.expenses.set(expenses);
          this.pnl.set(pnl);
        },
        error: (error: unknown) => this.loadError.set(httpErrorMessage(error)),
      });
  }

  protected submit(): void {
    if (this.saving()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Choose a category, amount, and date.');
      return;
    }
    const raw = this.form.getRawValue();
    if (!raw.expenseCategoryId || raw.amount == null || !raw.incurredAt) {
      return;
    }

    const body = {
      expenseCategoryId: raw.expenseCategoryId,
      amount: raw.amount,
      incurredAt: raw.incurredAt.toISOString(),
      note: raw.note.trim() || undefined,
    };

    this.saving.set(true);
    this.formError.set(null);
    const id = this.editingId();
    const request = id
      ? this.expensesService.update(id, body)
      : this.expensesService.create(body);

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => {
          this.resetForm();
          this.load();
        },
        error: (error: unknown) => this.formError.set(httpErrorMessage(error)),
      });
  }

  protected editExpense(expense: Expense): void {
    this.cancelArchive();
    this.editingId.set(expense.id);
    this.form.setValue({
      expenseCategoryId: expense.expenseCategoryId,
      amount: Number(expense.amount),
      incurredAt: new Date(expense.incurredAt),
      note: expense.note ?? '',
    });
    this.formError.set(null);
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.form.reset({ expenseCategoryId: null, amount: null, incurredAt: new Date(), note: '' });
    this.formError.set(null);
  }

  protected confirmArchive(expense: Expense): void {
    this.archivingId.set(expense.id);
  }

  protected cancelArchive(): void {
    this.archivingId.set(null);
  }

  protected archive(expense: Expense): void {
    if (this.busyId()) {
      return;
    }
    this.busyId.set(expense.id);
    this.expensesService
      .archive(expense.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busyId.set(null)),
      )
      .subscribe({
        next: () => {
          this.archivingId.set(null);
          if (this.editingId() === expense.id) {
            this.resetForm();
          }
          this.load();
        },
        error: (error: unknown) => this.formError.set(httpErrorMessage(error)),
      });
  }

  protected openQuick(): void {
    this.quickError.set(null);
    this.quickCategoryName.reset('');
  }

  protected createCategory(popover: Popover): void {
    const name = this.quickCategoryName.value.trim();
    this.quickError.set(null);
    if (!name) {
      this.quickError.set('Enter a name.');
      return;
    }
    if (this.quickBusy()) {
      return;
    }

    this.quickBusy.set(true);
    this.categoriesService
      .create({ name })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.quickBusy.set(false)),
      )
      .subscribe({
        next: (created) => {
          this.categories.update((list) =>
            [...list, created].sort((a, b) => a.name.localeCompare(b.name)),
          );
          this.form.controls.expenseCategoryId.setValue(created.id);
          this.quickCategoryName.reset('');
          popover.hide();
        },
        error: (error: unknown) => this.quickError.set(httpErrorMessage(error, `"${name}"`)),
      });
  }

  protected isArchiving(expense: Expense): boolean {
    return this.archivingId() === expense.id;
  }

  protected periodChipClasses(active: boolean): string {
    const base =
      'rounded-md px-3 py-1.5 text-xs font-medium outline-none transition-colors ' +
      'motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-signal ' +
      'focus-visible:ring-offset-2 focus-visible:ring-offset-counter';
    return active
      ? `${base} bg-signal/10 text-ink`
      : `${base} text-muted hover:bg-line/60 hover:text-ink`;
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
      case 'mtd':
        return { from: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0), to: this.endOfDay(now) };
      default: {
        const range = this.customRange.value;
        if (!range || !range[0] || !range[1]) {
          return null;
        }
        return { from: this.startOfDay(range[0]), to: this.endOfDay(range[1]) };
      }
    }
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
