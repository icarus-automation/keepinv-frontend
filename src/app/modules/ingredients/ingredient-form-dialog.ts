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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, finalize, map, of, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { CategoriesService } from '../categories/services/categories.service';
import { SuppliersService } from '../suppliers/services/suppliers.service';
import { ProductsService } from '../products/services/products.service';
import {
  Product,
  ProductRequest,
  generateIngredientSku,
} from '../products/types/product.types';

/** A record with the minimum a `p-select` option needs: an id and a name. */
interface NamedRecord {
  id: string;
  name: string;
}

/**
 * Create/edit dialog for a kitchen ingredient: an `isStockOnly` product the POS never sells but
 * recipes draw down. Deliberately smaller than the menu-item form — an ingredient needs a name,
 * a cost (for recipe costing), an optional low-stock threshold, and an optional supplier. New
 * ingredients file under the per-tenant "Ingredients" category (created on first use) with a
 * generated SKU. Editing also hosts archive, which the backend refuses while live recipes still
 * use the ingredient.
 */
@Component({
  selector: 'app-ingredient-form-dialog',
  imports: [ReactiveFormsModule, ButtonModule, InputNumberModule, InputTextModule, SelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      (click)="close()"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ing-form-title"
        tabindex="-1"
        (click)="$event.stopPropagation()"
        (keydown.escape)="close()"
        class="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-xl border border-line bg-counter shadow-xl outline-none sm:rounded-xl"
      >
        <div class="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div class="min-w-0">
            <h2 id="ing-form-title" class="text-sm font-semibold text-ink">
              {{ isEdit() ? 'Edit ingredient' : 'New ingredient' }}
            </h2>
            <p class="text-xs text-muted">
              {{ isEdit() ? 'Kitchen stock the menu draws down.' : 'Starts at 0 on hand — add stock after saving.' }}
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

        <form [formGroup]="form" (ngSubmit)="save()" novalidate class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div class="flex flex-col gap-1.5">
            <label for="ing-name" class="text-sm font-medium text-ink">Name</label>
            <input
              pInputText
              #nameInput
              id="ing-name"
              type="text"
              formControlName="name"
              autocomplete="off"
              maxlength="150"
              placeholder="e.g. Lugaw Cup"
              [invalid]="form.controls.name.touched && form.controls.name.invalid"
              class="w-full text-sm"
            />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label for="ing-cost" class="text-sm font-medium text-ink">Cost per unit</label>
              <p-inputnumber
                inputId="ing-cost"
                formControlName="costPrice"
                mode="currency"
                currency="PHP"
                locale="en-PH"
                [min]="0"
                styleClass="w-full"
                inputStyleClass="w-full text-sm tabular-nums"
              />
              <p class="text-xs text-muted">Used to estimate what a serving costs.</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="ing-reorder" class="text-sm font-medium text-ink">
                Low-stock alert <span class="font-normal text-muted">(optional)</span>
              </label>
              <p-inputnumber
                inputId="ing-reorder"
                formControlName="reorderPoint"
                [min]="0"
                [maxFractionDigits]="0"
                [useGrouping]="false"
                placeholder="Flag at or below"
                styleClass="w-full"
                inputStyleClass="w-full text-sm tabular-nums"
              />
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="ing-supplier" class="text-sm font-medium text-ink">
              Supplier <span class="font-normal text-muted">(optional)</span>
            </label>
            <p-select
              inputId="ing-supplier"
              formControlName="supplierId"
              [options]="supplierOptions()"
              optionLabel="name"
              optionValue="id"
              [filter]="true"
              filterBy="name"
              [showClear]="true"
              [loading]="optionsLoading()"
              placeholder="No supplier"
              appendTo="body"
              styleClass="w-full text-sm"
            />
          </div>

          @if (isEdit()) {
            <div class="rounded-lg border border-line p-3">
              @if (!confirmingArchive()) {
                <div class="flex items-center justify-between gap-3">
                  <p class="text-xs text-muted">
                    Archiving hides this ingredient. Recipes using it must drop it first.
                  </p>
                  <p-button
                    type="button"
                    label="Archive"
                    icon="pi pi-inbox"
                    severity="danger"
                    [text]="true"
                    (onClick)="confirmingArchive.set(true)"
                    styleClass="shrink-0 text-xs font-medium"
                  />
                </div>
              } @else {
                <p class="text-sm font-medium text-ink">Archive this ingredient?</p>
                <div class="mt-2 flex items-center gap-1.5">
                  <p-button
                    type="button"
                    [label]="archiving() ? 'Archiving...' : 'Yes, archive'"
                    severity="danger"
                    [loading]="archiving()"
                    [disabled]="archiving()"
                    (onClick)="archive()"
                    styleClass="text-xs font-medium"
                  />
                  <p-button
                    type="button"
                    label="Keep it"
                    [text]="true"
                    (onClick)="confirmingArchive.set(false)"
                    styleClass="text-xs text-muted"
                  />
                </div>
              }
            </div>
          }

          @if (error(); as message) {
            <p role="alert" class="text-sm text-danger">{{ message }}</p>
          }
        </form>

        <div class="flex items-center gap-1.5 border-t border-line px-4 py-3">
          <p-button
            type="button"
            [label]="saving() ? 'Saving...' : isEdit() ? 'Save changes' : 'Create ingredient'"
            icon="pi pi-check"
            [loading]="saving()"
            [disabled]="saving()"
            (onClick)="save()"
            styleClass="font-medium"
          />
          <p-button type="button" label="Cancel" [text]="true" (onClick)="close()" styleClass="text-muted" />
        </div>
      </div>
    </div>
  `,
})
export class IngredientFormDialog implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly products = inject(ProductsService);
  private readonly categories = inject(CategoriesService);
  private readonly suppliers = inject(SuppliersService);
  private readonly destroyRef = inject(DestroyRef);

  /** Present in edit mode; null in create mode. */
  readonly ingredient = input<Product | null>(null);
  readonly saved = output<Product>();
  readonly archived = output<string>();
  readonly closed = output<void>();

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly isEdit = computed(() => this.ingredient() != null);

  protected readonly supplierOptions = signal<NamedRecord[]>([]);
  protected readonly optionsLoading = signal(true);
  private readonly categoryOptions = signal<NamedRecord[]>([]);

  protected readonly saving = signal(false);
  protected readonly archiving = signal(false);
  protected readonly confirmingArchive = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(150)]],
    costPrice: this.formBuilder.control<number | null>(0, [Validators.min(0)]),
    reorderPoint: this.formBuilder.control<number | null>(null, [Validators.min(0)]),
    supplierId: this.formBuilder.control<string | null>(null),
  });

  constructor() {
    afterNextRender(() => this.nameInput()?.nativeElement.focus());
  }

  ngOnInit(): void {
    const ingredient = this.ingredient();
    if (ingredient) {
      this.form.setValue({
        name: ingredient.name,
        costPrice: Number(ingredient.costPrice),
        reorderPoint: ingredient.reorderPoint,
        supplierId: ingredient.supplierId,
      });
    }

    this.suppliers
      .list()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.optionsLoading.set(false)),
      )
      .subscribe({
        next: (items) => {
          const options: NamedRecord[] = items.map(({ id, name }) => ({ id, name }));
          const current = ingredient?.supplier;
          if (current && !options.some((option) => option.id === current.id)) {
            options.unshift({ id: current.id, name: current.name });
          }
          this.supplierOptions.set(options);
        },
        error: (error: unknown) => this.error.set(httpErrorMessage(error)),
      });

    this.categories
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) =>
        this.categoryOptions.set(items.map(({ id, name }) => ({ id, name }))),
      );
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Give the ingredient a name.');
      return;
    }

    const raw = this.form.getRawValue();
    const existing = this.ingredient();
    const name = raw.name.trim();

    const request$: Observable<Product> = existing
      ? this.products.update(existing.id, this.buildBody(name, raw, existing))
      : this.ensureIngredientsCategory().pipe(
          switchMap((categoryId) =>
            this.products.create({
              ...this.buildBody(name, raw, null),
              sku: generateIngredientSku(name),
              categoryId,
            }),
          ),
        );

    this.saving.set(true);
    this.error.set(null);
    request$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (product) => this.saved.emit(product),
        error: (error: unknown) => this.error.set(httpErrorMessage(error, `"${name}"`)),
      });
  }

  /**
   * The write payload both modes share. An ingredient never sells, so its selling price stays 0
   * (or whatever it already carries) and the stock-only/tracked flags are pinned; edit keeps the
   * existing SKU and category.
   */
  private buildBody(
    name: string,
    raw: ReturnType<typeof this.form.getRawValue>,
    existing: Product | null,
  ): ProductRequest {
    return {
      name,
      sku: existing?.sku ?? '',
      costPrice: raw.costPrice ?? 0,
      sellingPrice: existing ? Number(existing.sellingPrice) : 0,
      reorderPoint: raw.reorderPoint ?? null,
      categoryId: existing?.categoryId ?? '',
      supplierId: raw.supplierId || null,
      isStockOnly: true,
      isStockTracked: true,
      components: [],
    };
  }

  /** The per-tenant "Ingredients" category new ingredients file under; created on first use. */
  private ensureIngredientsCategory(): Observable<string> {
    const existing = this.categoryOptions().find(
      (option) => option.name.trim().toLowerCase() === 'ingredients',
    );
    if (existing) {
      return of(existing.id);
    }
    return this.categories
      .create({ name: 'Ingredients' })
      .pipe(map((created) => created.id));
  }

  protected archive(): void {
    const existing = this.ingredient();
    if (!existing || this.archiving()) {
      return;
    }
    this.archiving.set(true);
    this.error.set(null);
    this.products
      .archive(existing.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.archiving.set(false)),
      )
      .subscribe({
        next: () => this.archived.emit(existing.id),
        // The backend refuses while live recipes still use it, naming them in the message.
        error: (error: unknown) => this.error.set(httpErrorMessage(error)),
      });
  }

  protected close(): void {
    this.closed.emit();
  }
}
