import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { Product } from '../products/types/product.types';
import { StockMovementsService } from '../stock-movements/services/stock-movements.service';
import { StockMovement } from '../stock-movements/types/stock-movement.types';
import { StockMovementTypesService } from '../stock-movement-types/services/stock-movement-types.service';
import {
  StockMovementType,
  isRecordableType,
} from '../stock-movement-types/types/stock-movement-type.types';

/** The two things a kitchen does to an ingredient's count, in its own words. */
type StockMode = 'add' | 'count';

/**
 * Restock/correct dialog for one ingredient. "Add stock" records an increase (the Purchase type)
 * of the entered amount; "Set counted total" records an adjustment where the entered number IS
 * the new on-hand — mirroring the stock-movement record screen's semantics, so both write the
 * same append-only ledger the movements page shows.
 */
@Component({
  selector: 'app-ingredient-stock-dialog',
  imports: [ReactiveFormsModule, ButtonModule, InputNumberModule, InputTextModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      (click)="close()"
    >
      <div
        #panel
        role="dialog"
        aria-modal="true"
        aria-labelledby="ing-stock-title"
        tabindex="-1"
        (click)="$event.stopPropagation()"
        (keydown.escape)="close()"
        class="w-full max-w-md overflow-hidden rounded-t-xl border border-line bg-counter shadow-xl outline-none sm:rounded-xl"
      >
        <div class="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div class="min-w-0">
            <h2 id="ing-stock-title" class="text-sm font-semibold text-ink">Update stock</h2>
            <p class="truncate text-xs text-muted">
              {{ ingredient().name }} ·
              <span class="tabular-nums">{{ ingredient().quantityOnHand }}</span> on hand now
            </p>
          </div>
          <button
            type="button"
            (click)="close()"
            aria-label="Close"
            class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-counter"
          >
            <i class="pi pi-times text-xs" aria-hidden="true"></i>
          </button>
        </div>

        <div class="space-y-4 px-4 py-4">
          <!-- Mode -->
          <div class="grid grid-cols-2 gap-2" role="group" aria-label="What to record">
            <button
              type="button"
              (click)="setMode('add')"
              [attr.aria-pressed]="mode() === 'add'"
              class="rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-counter"
              [class]="mode() === 'add' ? 'border-signal bg-signal/5' : 'border-line hover:border-signal/50'"
            >
              <span class="flex items-center gap-1.5 text-sm font-medium text-ink">
                <i class="pi pi-plus text-xs text-signal" aria-hidden="true"></i>
                Add stock
              </span>
              <span class="mt-0.5 block text-xs text-muted">A delivery or restock</span>
            </button>
            <button
              type="button"
              (click)="setMode('count')"
              [attr.aria-pressed]="mode() === 'count'"
              class="rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-counter"
              [class]="mode() === 'count' ? 'border-signal bg-signal/5' : 'border-line hover:border-signal/50'"
            >
              <span class="flex items-center gap-1.5 text-sm font-medium text-ink">
                <i class="pi pi-sliders-h text-xs text-signal" aria-hidden="true"></i>
                Set counted total
              </span>
              <span class="mt-0.5 block text-xs text-muted">You counted the shelf</span>
            </button>
          </div>

          <!-- Quantity -->
          <div class="flex flex-col gap-1.5">
            <label for="ing-stock-qty" class="text-sm font-medium text-ink">
              {{ mode() === 'add' ? 'How many to add' : 'Counted total on hand' }}
            </label>
            <p-inputnumber
              inputId="ing-stock-qty"
              [formControl]="quantity"
              [min]="0"
              [max]="999999"
              [maxFractionDigits]="0"
              [useGrouping]="false"
              [autofocus]="true"
              placeholder="0"
              styleClass="w-full"
              inputStyleClass="w-full text-lg tabular-nums"
            />
          </div>

          @if (preview(); as line) {
            <p class="rounded-md bg-panel px-3 py-2 text-sm text-muted" aria-live="polite">
              On hand:
              <span class="font-medium tabular-nums text-ink">{{ line.current }}</span>
              <i class="pi pi-arrow-right mx-1 text-[0.65rem]" aria-hidden="true"></i>
              <span class="font-semibold tabular-nums text-ink">{{ line.next }}</span>
              @if (line.deltaLabel) {
                <span class="tabular-nums"> ({{ line.deltaLabel }})</span>
              }
            </p>
          }

          <!-- Note -->
          <div class="flex flex-col gap-1.5">
            <label for="ing-stock-note" class="text-sm font-medium text-ink">
              Note <span class="font-normal text-muted">(optional)</span>
            </label>
            <input
              pInputText
              id="ing-stock-note"
              type="text"
              [formControl]="note"
              maxlength="500"
              autocomplete="off"
              placeholder="e.g. Palengke run"
              class="w-full text-sm"
            />
          </div>

          @if (error(); as message) {
            <p role="alert" class="text-sm text-danger">{{ message }}</p>
          }
        </div>

        <div class="flex items-center gap-1.5 border-t border-line px-4 py-3">
          <p-button
            type="button"
            [label]="saving() ? 'Saving...' : 'Record'"
            icon="pi pi-check"
            [loading]="saving()"
            [disabled]="saving() || !typesReady()"
            (onClick)="save()"
            styleClass="font-medium"
          />
          <p-button type="button" label="Cancel" [text]="true" (onClick)="close()" styleClass="text-muted" />
        </div>
      </div>
    </div>
  `,
})
export class IngredientStockDialog implements OnInit {
  private readonly movements = inject(StockMovementsService);
  private readonly movementTypes = inject(StockMovementTypesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly ingredient = input.required<Product>();
  readonly recorded = output<StockMovement>();
  readonly closed = output<void>();

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly mode = signal<StockMode>('add');
  protected readonly quantity = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(0),
  ]);
  protected readonly note = new FormControl('', { nonNullable: true });

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Recordable types, resolved once: Purchase (or any increase) for adds, Adjustment for counts. */
  private readonly types = signal<StockMovementType[]>([]);
  protected readonly typesReady = computed(() => this.resolveType() !== undefined);

  private readonly quantityValue = toSignal(this.quantity.valueChanges, {
    initialValue: this.quantity.value,
  });

  /** Live before → after preview, mirroring what the backend will store. */
  protected readonly preview = computed(() => {
    const qty = this.quantityValue();
    if (qty === null || qty < 0) {
      return null;
    }
    const current = this.ingredient().quantityOnHand;
    if (this.mode() === 'add') {
      return { current, next: current + qty, deltaLabel: qty > 0 ? `+${qty}` : null };
    }
    const delta = qty - current;
    return {
      current,
      next: qty,
      deltaLabel: delta === 0 ? null : delta > 0 ? `+${delta}` : `${delta}`,
    };
  });

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());
  }

  ngOnInit(): void {
    this.movementTypes
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => this.types.set(items.filter(isRecordableType)),
        error: (error: unknown) => this.error.set(httpErrorMessage(error)),
      });
  }

  protected setMode(mode: StockMode): void {
    this.mode.set(mode);
    this.error.set(null);
  }

  /** The movement type this mode records under: Purchase-first for adds, Adjustment for counts. */
  private resolveType(): StockMovementType | undefined {
    const types = this.types();
    if (this.mode() === 'add') {
      return (
        types.find((type) => type.systemKey === 'PURCHASE') ??
        types.find((type) => type.effect === 'INCREASE')
      );
    }
    return (
      types.find((type) => type.systemKey === 'ADJUSTMENT') ??
      types.find((type) => type.effect === 'ADJUSTMENT')
    );
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    const qty = this.quantity.value;
    // An adjustment may set the counted total to 0; an add of 0 moves nothing.
    if (qty === null || qty < 0 || (this.mode() === 'add' && qty < 1)) {
      this.quantity.markAsTouched();
      this.error.set(
        this.mode() === 'add' ? 'Enter how many to add (at least 1).' : 'Enter the counted total (0 or more).',
      );
      return;
    }
    const type = this.resolveType();
    if (!type) {
      this.error.set('No matching movement type found. Check Movement Types.');
      return;
    }

    const note = this.note.value.trim();
    this.saving.set(true);
    this.error.set(null);
    this.movements
      .record({
        productId: this.ingredient().id,
        stockMovementTypeId: type.id,
        quantity: qty,
        note: note.length ? note : undefined,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (movement) => {
          this.recorded.emit(movement);
          this.closed.emit();
        },
        error: (error: unknown) => this.error.set(httpErrorMessage(error)),
      });
  }

  protected close(): void {
    this.closed.emit();
  }
}
