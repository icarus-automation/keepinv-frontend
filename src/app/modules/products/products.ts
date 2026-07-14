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
import { debounceTime, distinctUntilChanged, finalize, merge } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';

import { CategoriesService } from '../categories/services/categories.service';
import { LocationsService } from '../locations/services/locations.service';
import { ProductsService } from './services/products.service';
import {
  Product,
  ProductListQuery,
  StockState,
  isNonStockProduct,
  isRecipeProduct,
  stockState,
} from './types/product.types';
import { platformMeta } from '../suppliers/types/supplier.types';
import { httpErrorMessage } from '../../../common/http/http-error-message';
import { MoneyPipe } from './utils/money.pipe';
import { ProductDetail } from './detail/product-detail';
import { ProductForm } from './form/product-form';

interface FilterOption {
  id: string;
  name: string;
}

/**
 * Products catalog. Two-pane: a server-paginated, scanner-searchable table on the
 * left, the selected product's detail (or the create form) on the right. The
 * filter toolbar maps one-to-one to the backend query: free-text search across
 * name/SKU/barcode, category and location, and a "low stock only" toggle for the
 * reorder sweep.
 */
@Component({
  selector: 'app-products',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    CheckboxModule,
    TableModule,
    DecimalPipe,
    MoneyPipe,
    ProductDetail,
    ProductForm,
  ],
  templateUrl: './products.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Products {
  private readonly service = inject(ProductsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly locationsService = inject(LocationsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly products = signal<Product[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);

  /** Server page size. The backend caps `limit` at 50; 10 keeps each fetch snappy. */
  protected readonly rows = 10;
  protected readonly first = signal(0);

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly categoryControl = new FormControl<string | null>(null);
  protected readonly locationControl = new FormControl<string | null>(null);
  protected readonly lowStockControl = new FormControl(false, { nonNullable: true });

  protected readonly categoryOptions = signal<FilterOption[]>([]);
  protected readonly locationOptions = signal<FilterOption[]>([]);

  protected readonly selected = signal<Product | null>(null);
  protected readonly mode = signal<'view' | 'create'>('view');
  /** On narrow screens the right pane replaces the list; this toggles between them. */
  protected readonly paneOpenMobile = signal(false);

  protected readonly hasFilters = signal(false);
  /** Holds the backend's error message for the list load, or null when healthy. */
  protected readonly loadError = signal<string | null>(null);
  /**
   * No products at all (not merely filtered to nothing). Drives the first-run empty
   * state. Suppressed in create mode so clicking "New product" on an empty catalog
   * reveals the form pane instead of staying on the empty state.
   */
  protected readonly isEmptyCatalog = computed(
    () =>
      this.mode() !== 'create' &&
      !this.loading() &&
      !this.loadError() &&
      this.total() === 0 &&
      !this.hasFilters(),
  );

  constructor() {
    this.loadFilterOptions();

    // A settled search term re-queries from page one. Pagination is driven
    // separately by the table's lazy event.
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());

    // Dropdowns and the toggle apply immediately.
    merge(
      this.categoryControl.valueChanges,
      this.locationControl.valueChanges,
      this.lowStockControl.valueChanges,
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());

    // `?new=1` (from the global "new product" shortcut) opens the create form, then
    // strips the param so a refresh or back-nav doesn't reopen it.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        if (params.get('new') !== null) {
          this.startCreate();
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {},
            replaceUrl: true,
          });
        }
      });

    this.load();
  }

  /**
   * The table re-emits onLazyLoad whenever its data/total/first bindings change,
   * not just on user paging. Reacting to those re-emits would feed back into
   * load() and spam the server, so we only act on a genuine page change. The
   * initial load is driven from the constructor.
   */
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
    // A new filter may exclude the selected product; drop it so load() re-selects
    // the top match rather than leaving a product on screen that's off the list.
    this.selected.set(null);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.hasFilters.set(this.computeHasFilters());

    const query: ProductListQuery = {
      page: Math.floor(this.first() / this.rows) + 1,
      limit: this.rows,
      search: this.searchControl.value.trim() || undefined,
      categoryId: this.categoryControl.value ?? undefined,
      locationId: this.locationControl.value ?? undefined,
      lowStock: this.lowStockControl.value || undefined,
    };

    this.service
      .list(query)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ({ items, meta }) => {
          this.products.set(items);
          this.total.set(meta.total);
          // Archiving the last row on a page leaves us past the final page; step
          // back to the new last page rather than stranding an empty paginator.
          if (!items.length && meta.total > 0 && this.first() > 0) {
            this.first.set(Math.max(0, Math.ceil(meta.total / this.rows) - 1) * this.rows);
            this.load();
            return;
          }
          if (this.mode() === 'view' && !this.selected() && items.length) {
            this.selected.set(items[0]);
          }
        },
        error: (error: unknown) => this.loadError.set(httpErrorMessage(error)),
      });
  }

  protected clearFilters(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.categoryControl.setValue(null, { emitEvent: false });
    this.locationControl.setValue(null, { emitEvent: false });
    this.lowStockControl.setValue(false, { emitEvent: false });
    this.applyFilters();
  }

  protected selectProduct(product: Product): void {
    this.mode.set('view');
    this.selected.set(product);
    this.paneOpenMobile.set(true);
  }

  protected onSelectionChange(product: Product | null): void {
    // Single-selection toggles off on re-click; ignore the deselect so the pane
    // keeps a product in view.
    if (product) {
      this.selectProduct(product);
    }
  }

  protected startCreate(): void {
    this.mode.set('create');
    this.paneOpenMobile.set(true);
  }

  protected cancelCreate(): void {
    this.mode.set('view');
    this.paneOpenMobile.set(this.selected() != null);
  }

  protected onCreated(product: Product): void {
    this.mode.set('view');
    // The create response omits the embedded category/supplier/location, so we
    // never render it directly; select the authoritative nested record once the
    // hydrate fetch resolves instead of the relation-less write response.
    this.hydrateSelected(product.id, true);
    // The new row may or may not land on the current page; refetch to stay truthful.
    this.load();
  }

  protected onUpdated(updated: Product): void {
    // The update response omits the embedded relations too; keep the current
    // (hydrated) record on screen and let the hydrate fetch swap in the refreshed
    // one, so the list and detail never render a product missing its category.
    this.hydrateSelected(updated.id);
  }

  /**
   * The photo changed. Unlike a form save, the image endpoints always return a fully hydrated
   * product (category/supplier/location included) — apply it directly instead of re-fetching,
   * which was both wasted work and a staleness race with the redundant GET.
   */
  protected onPhotoChanged(updated: Product): void {
    this.products.update((list) =>
      list.map((item) => (item.id === updated.id ? updated : item)),
    );
    if (this.selected()?.id === updated.id) {
      this.selected.set(updated);
    }
  }

  /**
   * Re-fetch the full product after a write. Create/update responses aren't
   * guaranteed to embed the related category/supplier/location the detail pane
   * shows, so GET /:id gives an authoritative, nested record. Pass `select` to
   * adopt the fetched record as the selection (used after a create, where there
   * is no prior selection to match on).
   */
  private hydrateSelected(id: string, select = false): void {
    this.service
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((product) => {
        if (select || this.selected()?.id === id) {
          this.selected.set(product);
        }
        this.products.update((list) =>
          list.map((item) => (item.id === id ? product : item)),
        );
      });
  }

  /**
   * A unit-level mutation (register, status change, retire) shifted on-hand for the
   * selected product. Re-hydrate it so the catalog row and detail header stay truthful.
   */
  protected onUnitsChanged(): void {
    const id = this.selected()?.id;
    if (id) {
      this.hydrateSelected(id);
    }
  }

  protected onArchived(id: string): void {
    if (this.selected()?.id === id) {
      this.selected.set(null);
    }
    this.paneOpenMobile.set(false);
    // Archiving shifts totals and page contents; refetch the current page.
    this.load();
  }

  protected backToList(): void {
    this.paneOpenMobile.set(false);
  }

  protected stockOf(product: Product): StockState {
    return stockState(product);
  }

  /** Not inventoried (recipe bowl or untracked refill): shown as a badge, never a stock count. */
  protected isNonStock(product: Product): boolean {
    return isNonStockProduct(product);
  }

  /** A recipe/menu item (bowl) specifically — picks the "Recipe" badge over "Always available". */
  protected isRecipe(product: Product): boolean {
    return isRecipeProduct(product);
  }

  /** Platform label for a row's reorder shortcut (drives the link's accessible name). */
  protected reorderLabel(product: Product): string {
    return product.reorderPlatform ? platformMeta(product.reorderPlatform).label : 'supplier store';
  }

  /** Platform icon for a row's reorder shortcut; a generic cart when none is set. */
  protected reorderIcon(product: Product): string {
    return product.reorderPlatform ? platformMeta(product.reorderPlatform).icon : 'pi pi-shopping-cart';
  }

  private computeHasFilters(): boolean {
    return (
      !!this.searchControl.value.trim() ||
      this.categoryControl.value !== null ||
      this.locationControl.value !== null ||
      this.lowStockControl.value
    );
  }

  private loadFilterOptions(): void {
    this.categoriesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.categoryOptions.set(items.map(({ id, name }) => ({ id, name }))));
    this.locationsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.locationOptions.set(items.map(({ id, name }) => ({ id, name }))));
  }
}
