import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { ProductsService } from '../products/services/products.service';
import {
  Product,
  ProductListQuery,
  StockState,
  stockState,
} from '../products/types/product.types';
import { IngredientFormDialog } from './ingredient-form-dialog';
import { IngredientStockDialog } from './ingredient-stock-dialog';

/**
 * Kitchen stock: the isStockOnly half of the catalog — cups, tokwa, everything recipes draw down
 * but the POS never sells as a tile. Built for the two things the owner does here daily: glance
 * at what's running low, and record a restock or a shelf count in two taps. Creating and editing
 * happen in a compact dialog; menu items (the sellable half) live on /products.
 */
@Component({
  selector: 'app-ingredients',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    InputTextModule,
    TableModule,
    DecimalPipe,
    IngredientFormDialog,
    IngredientStockDialog,
  ],
  templateUrl: './ingredients.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Ingredients {
  private readonly service = inject(ProductsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly items = signal<Product[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  /** Server page size; matches the products catalog. */
  protected readonly rows = 10;
  protected readonly first = signal(0);

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly lowStockControl = new FormControl(false, { nonNullable: true });
  protected readonly hasFilters = signal(false);

  // --- Dialogs ---
  /** Ingredient whose stock is being updated, or null when the dialog is closed. */
  protected readonly stockFor = signal<Product | null>(null);
  /** Ingredient being edited, or null. */
  protected readonly editing = signal<Product | null>(null);
  protected readonly creating = signal(false);

  protected readonly isEmpty = computed(
    () =>
      !this.creating() &&
      !this.loading() &&
      !this.loadError() &&
      this.total() === 0 &&
      !this.hasFilters(),
  );

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());

    this.lowStockControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());

    // `?new=1` (from the global N,I chord) opens the create dialog, then strips the param
    // so a refresh or back-nav doesn't reopen it.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        if (params.get('new') !== null) {
          this.creating.set(true);
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {},
            replaceUrl: true,
          });
        }
      });

    this.load();
  }

  /** React only to genuine page changes; the table re-emits on data updates too. */
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
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.hasFilters.set(!!this.searchControl.value.trim() || this.lowStockControl.value);

    const query: ProductListQuery = {
      page: Math.floor(this.first() / this.rows) + 1,
      limit: this.rows,
      search: this.searchControl.value.trim() || undefined,
      lowStock: this.lowStockControl.value || undefined,
      kind: 'INGREDIENT',
    };

    this.service
      .list(query)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ({ items, meta }) => {
          this.items.set(items);
          this.total.set(meta.total);
          // Archiving the last row on a page leaves us past the final page; step back.
          if (!items.length && meta.total > 0 && this.first() > 0) {
            this.first.set(Math.max(0, Math.ceil(meta.total / this.rows) - 1) * this.rows);
            this.load();
          }
        },
        error: (error: unknown) => this.loadError.set(httpErrorMessage(error)),
      });
  }

  protected clearFilters(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.lowStockControl.setValue(false, { emitEvent: false });
    this.applyFilters();
  }

  // --- Dialog wiring ---

  protected openStock(ingredient: Product): void {
    this.stockFor.set(ingredient);
  }

  protected openEdit(ingredient: Product): void {
    this.editing.set(ingredient);
  }

  protected startCreate(): void {
    this.creating.set(true);
  }

  protected closeDialogs(): void {
    this.stockFor.set(null);
    this.editing.set(null);
    this.creating.set(false);
  }

  /** Any write (movement, save, archive) refreshes the page so counts stay truthful. */
  protected onChanged(): void {
    this.closeDialogs();
    this.load();
  }

  // --- Row helpers ---

  protected stockOf(ingredient: Product): StockState {
    return stockState(ingredient);
  }

  /** How many active menu items draw on this ingredient (0 when the API omits the count). */
  protected usedIn(ingredient: Product): number {
    return ingredient._count?.componentOf ?? 0;
  }
}
