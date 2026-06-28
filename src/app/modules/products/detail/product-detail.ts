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
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';

import { ProductsService } from '../services/products.service';
import { Product, stockState } from '../types/product.types';
import { platformMeta } from '../../suppliers/types/supplier.types';
import { httpErrorMessage } from '../../../../common/http/http-error-message';
import { MoneyPipe } from '../utils/money.pipe';
import { ProductForm } from '../form/product-form';
import { ProductImage } from './product-image';
import { PrintLabelButton } from '../../../../common/printing/print-label-button';
import { UnitsRoster } from '../units/units-roster';
import { CommissionSession } from '../units/commission-session';

/** Which view the detail body shows for a serialized product. */
type DetailTab = 'overview' | 'units';

/**
 * Detail pane for one product: an at-a-glance stock and price summary, the full
 * record, and inline edit (via the shared product form) and archive. Owns only
 * transient pane state; reports product mutations up to the catalog container.
 */
@Component({
  selector: 'app-product-detail',
  imports: [
    ButtonModule,
    DatePipe,
    DecimalPipe,
    MoneyPipe,
    ProductForm,
    ProductImage,
    UnitsRoster,
    CommissionSession,
    PrintLabelButton,
    RouterLink,
  ],
  templateUrl: './product-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class ProductDetail {
  private readonly service = inject(ProductsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly product = input.required<Product>();
  readonly updated = output<Product>();
  readonly archived = output<string>();
  /** A unit mutation may have shifted on-hand; the catalog should re-hydrate this product. */
  readonly unitsChanged = output<void>();

  private readonly roster = viewChild(UnitsRoster);

  protected readonly editing = signal(false);
  protected readonly archiving = signal(false);
  protected readonly archiveBusy = signal(false);
  protected readonly archiveError = signal<string | null>(null);

  protected readonly tab = signal<DetailTab>('overview');
  protected readonly commissioning = signal(false);

  protected readonly stock = computed(() => stockState(this.product()));
  protected readonly isSerialized = computed(() => this.product().isSerialized);

  /**
   * The reorder shortcut for this product, or null when no link is set. Resolves
   * the platform to its icon/label, falling back to a generic store link so a
   * link without a platform still renders cleanly.
   */
  protected readonly reorder = computed(() => {
    const product = this.product();
    if (!product.reorderUrl) {
      return null;
    }
    const meta = product.reorderPlatform ? platformMeta(product.reorderPlatform) : null;
    return {
      url: product.reorderUrl,
      label: meta?.label ?? 'supplier store',
      icon: meta?.icon ?? 'pi pi-shopping-cart',
    };
  });
  protected readonly margin = computed(() => {
    const product = this.product();
    const selling = Number(product.sellingPrice);
    const cost = Number(product.costPrice);
    const amount = selling - cost;
    const pct = selling > 0 ? (amount / selling) * 100 : null;
    return { amount, pct };
  });

  /** Id the edit/archive state was last reset for; guards against re-resetting on refresh. */
  private resetForId: string | null = null;

  constructor() {
    // Selecting a *different* product drops any open edit/archive state so the
    // pane never shows stale intent. Compare by id, not object identity: a
    // post-write hydrate hands us a fresh object for the same product, and
    // resetting on that would cancel an edit the user just reopened.
    effect(() => {
      const id = this.product().id;
      if (id === this.resetForId) {
        return;
      }
      this.resetForId = id;
      this.editing.set(false);
      this.archiving.set(false);
      this.archiveError.set(null);
      this.tab.set('overview');
      this.commissioning.set(false);
    });
  }

  protected launchCommission(): void {
    this.commissioning.set(true);
  }

  protected onCommissionExited(): void {
    this.commissioning.set(false);
  }

  /** A register batch committed: refresh the roster and ask the catalog to re-hydrate on-hand. */
  protected onCommissioned(): void {
    this.roster()?.reload();
    this.unitsChanged.emit();
  }

  protected startEdit(): void {
    this.cancelArchive();
    this.editing.set(true);
  }

  protected onSaved(product: Product): void {
    this.editing.set(false);
    this.updated.emit(product);
  }

  protected confirmArchive(): void {
    this.editing.set(false);
    this.archiveError.set(null);
    this.archiving.set(true);
  }

  protected cancelArchive(): void {
    this.archiving.set(false);
    this.archiveError.set(null);
  }

  protected archive(): void {
    if (this.archiveBusy()) {
      return;
    }
    const id = this.product().id;
    this.archiveBusy.set(true);
    this.archiveError.set(null);
    this.service
      .archive(id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.archiveBusy.set(false)),
      )
      .subscribe({
        next: () => {
          this.archiving.set(false);
          this.archived.emit(id);
        },
        error: (error: unknown) => this.archiveError.set(httpErrorMessage(error)),
      });
  }

  protected onEscape(): void {
    this.cancelArchive();
  }
}
