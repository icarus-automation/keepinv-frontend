import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';

import { httpErrorMessage } from '../../../../common/http/http-error-message';
import { MoneyPipe } from '../../products/utils/money.pipe';
import { PosService } from '../services/pos.service';
import { PosUser, SaleListItem, SaleResult, SaleStatus } from '../types/pos.types';
import { Receipt } from '../components/receipt';
import { SaleStatusBadge } from '../components/sale-status-badge';

/**
 * The sales-ledger detail pane: the full receipt for a selected sale, plus the void
 * action. The list row carries only a summary, so the receipt body is fetched here;
 * the summary still paints the header instantly while it loads. Voiding restocks the
 * items and is irreversible, so it goes through an inline confirm (no modal) and
 * re-renders the sale as VOIDED in place, then asks the parent to refresh the row.
 */
@Component({
  selector: 'app-sale-detail',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    MoneyPipe,
    ButtonModule,
    TextareaModule,
    Receipt,
    SaleStatusBadge,
  ],
  templateUrl: './sale-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaleDetail {
  private readonly service = inject(PosService);
  private readonly destroyRef = inject(DestroyRef);

  /** The selected ledger row. Drives the header immediately; the body loads from it. */
  readonly sale = input.required<SaleListItem>();
  /** A void succeeded; the parent reloads the page so the row's status stays truthful. */
  readonly changed = output<void>();

  protected readonly result = signal<SaleResult | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly showVoidConfirm = signal(false);
  protected readonly voidReason = new FormControl('', { nonNullable: true });
  protected readonly voiding = signal(false);
  protected readonly voidError = signal<string | null>(null);

  /** Prefer the freshly loaded sale's status; fall back to the row while it loads. */
  protected readonly status = computed<SaleStatus>(
    () => this.result()?.sale.status ?? this.sale().status,
  );
  protected readonly canVoid = computed(() => this.status() === 'COMPLETED' && !!this.result());
  protected readonly voidedBy = computed(() => {
    const sale = this.result()?.sale;
    return sale?.voidedBy ? this.formatUser(sale.voidedBy) : null;
  });
  protected readonly voidedAt = computed(() => this.result()?.sale.voidedAt ?? null);
  protected readonly voidReasonText = computed(() => this.result()?.sale.voidReason ?? null);

  constructor() {
    // A new selection loads its receipt and clears any in-progress void.
    effect(() => {
      const id = this.sale().id;
      this.resetVoid();
      this.load(id);
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.result.set(null);

    this.service
      .getSale(id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          // Ignore a stale response if the operator already moved to another sale.
          if (this.sale().id === id) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (result) => {
          if (this.sale().id === id) {
            this.result.set(result);
          }
        },
        error: (error: unknown) => {
          if (this.sale().id === id) {
            this.loadError.set(httpErrorMessage(error));
          }
        },
      });
  }

  protected retry(): void {
    this.load(this.sale().id);
  }

  protected startVoid(): void {
    this.showVoidConfirm.set(true);
    this.voidError.set(null);
  }

  protected cancelVoid(): void {
    this.resetVoid();
  }

  protected confirmVoid(): void {
    if (this.voiding()) {
      return;
    }
    const id = this.sale().id;
    this.voiding.set(true);
    this.voidError.set(null);

    this.service
      .voidSale(id, this.voidReason.value.trim() || undefined)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.voiding.set(false)),
      )
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.resetVoid();
          this.changed.emit();
        },
        error: (error: unknown) => this.voidError.set(httpErrorMessage(error)),
      });
  }

  private resetVoid(): void {
    this.showVoidConfirm.set(false);
    this.voiding.set(false);
    this.voidError.set(null);
    this.voidReason.setValue('', { emitEvent: false });
  }

  private formatUser(user: PosUser): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name || user.email;
  }
}
