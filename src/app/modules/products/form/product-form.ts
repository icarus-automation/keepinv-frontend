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
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Observable, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { Popover, PopoverModule } from 'primeng/popover';

import { CategoriesService } from '../../categories/services/categories.service';
import { SuppliersService } from '../../suppliers/services/suppliers.service';
import { LocationsService } from '../../locations/services/locations.service';
import { MenuService } from '../../menu/services/menu.service';
import { Category } from '../../categories/types/category.types';
import { Supplier } from '../../suppliers/types/supplier.types';
import { Location } from '../../locations/types/location.types';
import { ProductsService } from '../services/products.service';
import {
  Product,
  ProductRequest,
  detectReorderPlatform,
  generateIngredientSku,
  isComponentEligible,
} from '../types/product.types';
import {
  SUPPLIER_PLATFORMS,
  SupplierPlatform,
} from '../../suppliers/types/supplier.types';
import { httpErrorMessage } from '../../../../common/http/http-error-message';
import { formatPeso } from '../utils/money.pipe';

/** A record with the minimum a `p-select` option needs: an id and a name to show. */
interface NamedRecord {
  id: string;
  name: string;
}

/**
 * How a menu item's stock works, in the client's words:
 * - `recipe`: selling one deducts its ingredients (a bowl draws a cup + toppings).
 * - `own-stock`: counted directly — selling one deducts this item (drinks, eggs).
 * - `always`: never runs out and deducts nothing (a refill reusing the same cup).
 */
type StockBehaviour = 'recipe' | 'own-stock' | 'always';

interface StockBehaviourOption {
  readonly value: StockBehaviour;
  readonly label: string;
  readonly hint: string;
  readonly icon: string;
}

const STOCK_BEHAVIOURS: readonly StockBehaviourOption[] = [
  {
    value: 'recipe',
    label: 'Uses ingredients',
    hint: 'Selling one deducts its ingredients — a bowl uses a cup and toppings.',
    icon: 'pi pi-book',
  },
  {
    value: 'own-stock',
    label: 'Has its own stock',
    hint: 'Counted directly — selling one deducts this item (drinks, eggs).',
    icon: 'pi pi-box',
  },
  {
    value: 'always',
    label: 'Always available',
    hint: 'Never runs out and deducts nothing — a refill reusing the same cup.',
    icon: 'pi pi-infinity',
  },
];

/** An ingredient the recipe picker can offer, with the cost the per-serving estimate sums. */
interface IngredientOption {
  id: string;
  name: string;
  costPriceCents: number;
  quantityOnHand: number;
}

type RecipeRowGroup = FormGroup<{
  componentId: FormControl<string>;
  quantity: FormControl<number>;
}>;

/**
 * Reorder link must be an http(s) URL with a protocol, mirroring the backend's
 * `@IsUrl({ require_protocol: true })`. Empty is allowed (the field is optional).
 */
function reorderUrlValidator(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').trim();
  if (!value) {
    return null;
  }
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? null : { reorderUrl: true };
  } catch {
    return { reorderUrl: true };
  }
}

/**
 * The single menu-item form, used for both create (no `product`) and edit (a `product` to seed
 * from). The stock-behaviour picker decides what the item deducts when sold; choosing "uses
 * ingredients" opens the recipe rows, whose ingredients can be quick-created without leaving the
 * form (as can a category, supplier, or location). `quantityOnHand` is deliberately absent:
 * stock only moves through stock movements, on the Ingredients page or the movements ledger.
 */
@Component({
  selector: 'app-product-form',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    TextareaModule,
    SelectModule,
    PopoverModule,
  ],
  templateUrl: './product-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class ProductForm implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly products = inject(ProductsService);
  private readonly categories = inject(CategoriesService);
  private readonly suppliers = inject(SuppliersService);
  private readonly locations = inject(LocationsService);
  private readonly menu = inject(MenuService);
  private readonly destroyRef = inject(DestroyRef);

  /** Present in edit mode; null/undefined in create mode. */
  readonly product = input<Product | null>(null);
  readonly saved = output<Product>();
  readonly cancelled = output<void>();

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly isEdit = computed(() => this.product() != null);

  protected readonly categoryOptions = signal<NamedRecord[]>([]);
  protected readonly supplierOptions = signal<NamedRecord[]>([]);
  protected readonly locationOptions = signal<NamedRecord[]>([]);
  /** Drinks menu lines. Empty for a catalog that has none, which hides the placement section. */
  protected readonly menuGroupOptions = signal<NamedRecord[]>([]);
  protected readonly optionsLoading = signal(true);

  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(150)]],
    sku: ['', [Validators.required, Validators.maxLength(64)]],
    barcode: ['', [Validators.maxLength(64)]],
    brand: ['', [Validators.maxLength(100)]],
    description: ['', [Validators.maxLength(1000)]],
    costPrice: this.formBuilder.control<number | null>(0, [Validators.min(0)]),
    sellingPrice: this.formBuilder.control<number | null>(0, [Validators.min(0)]),
    reorderPoint: this.formBuilder.control<number | null>(null, [Validators.min(0)]),
    reorderUrl: ['', [reorderUrlValidator, Validators.maxLength(2048)]],
    reorderPlatform: this.formBuilder.control<SupplierPlatform | null>(null),
    categoryId: ['', [Validators.required]],
    supplierId: this.formBuilder.control<string | null>(null),
    locationId: this.formBuilder.control<string | null>(null),
    // Drinks menu placement: which line this product is a size of, and what its button reads.
    menuGroupId: this.formBuilder.control<string | null>(null),
    menuSizeLabel: ['', [Validators.maxLength(40)]],
  });

  // --- Stock behaviour + recipe ---

  protected readonly behaviourOptions = STOCK_BEHAVIOURS;
  /** Recipe is the default for a new item: this menu's staples are bowls made from ingredients. */
  protected readonly behaviour = signal<StockBehaviour>('recipe');

  protected readonly ingredientOptions = signal<IngredientOption[]>([]);

  /**
   * The recipe rows live outside the main form group so their validity only matters when the
   * behaviour is `recipe` — a drink's save must never be blocked by a leftover empty row.
   */
  protected readonly recipeRows = new FormArray<RecipeRowGroup>([]);

  private readonly recipeValue = toSignal(this.recipeRows.valueChanges, {
    initialValue: this.recipeRows.value,
  });
  private readonly sellingValue = toSignal(this.form.controls.sellingPrice.valueChanges, {
    initialValue: this.form.controls.sellingPrice.value,
  });

  /** Estimated ingredient cost per serving, from the picked ingredients' cost prices. */
  private readonly recipeCostCents = computed(() => {
    const costById = new Map(
      this.ingredientOptions().map((option) => [option.id, option.costPriceCents]),
    );
    return this.recipeValue().reduce((sum, row) => {
      const cost = row.componentId ? costById.get(row.componentId) : undefined;
      if (cost === undefined) {
        return sum;
      }
      return sum + cost * Math.max(1, Math.floor(row.quantity ?? 1));
    }, 0);
  });

  protected readonly recipeCostDisplay = computed(() => {
    const cents = this.recipeCostCents();
    return cents > 0 ? formatPeso(cents / 100) : null;
  });

  /** What one serving earns after ingredients, shown only once both sides are known. */
  protected readonly recipeMarginDisplay = computed(() => {
    const cents = this.recipeCostCents();
    const sellingCents = Math.round((this.sellingValue() ?? 0) * 100);
    if (cents <= 0 || sellingCents <= 0) {
      return null;
    }
    return formatPeso((sellingCents - cents) / 100);
  });

  /** Live mirror of the barcode control so the Generate action can react without zone churn. */
  private readonly barcodeValue = toSignal(this.form.controls.barcode.valueChanges, {
    initialValue: this.form.controls.barcode.value,
  });
  /** True once the field holds any code (manufacturer or internal). Generate hides behind this. */
  protected readonly hasBarcode = computed(() => this.barcodeValue().trim().length > 0);

  /** Reorder platform choices (icon + label), shared with the suppliers channel picker. */
  protected readonly platformOptions = [...SUPPLIER_PLATFORMS];
  /** Set once the operator touches the platform select: stop auto-detecting from the URL after that. */
  protected readonly platformPinned = signal(false);

  /** Quick-create controls live outside the main form so they never affect its validity. */
  protected readonly quickCategoryName = new FormControl('', { nonNullable: true });
  protected readonly quickSupplierName = new FormControl('', { nonNullable: true });
  protected readonly quickLocationName = new FormControl('', { nonNullable: true });
  protected readonly quickIngredientName = new FormControl('', { nonNullable: true });
  protected readonly quickBusy = signal(false);
  protected readonly quickError = signal<string | null>(null);

  constructor() {
    afterNextRender(() => this.nameInput()?.nativeElement.focus());

    // Auto-pick the platform from the pasted link so the operator rarely sets it
    // by hand. Stops the moment they choose one themselves (platformPinned), and
    // writes silently (emitEvent: false) so this never counts as a manual touch.
    this.form.controls.reorderUrl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (this.platformPinned()) {
          return;
        }
        this.form.controls.reorderPlatform.setValue(detectReorderPlatform(value ?? ''), {
          emitEvent: false,
        });
      });
  }

  ngOnInit(): void {
    // Inputs are populated by now (they are not in the constructor), so the edit
    // form seeds with the product's current values before the first render.
    this.seedFromProduct();
    if (!this.product() && this.recipeRows.length === 0) {
      // A fresh recipe starts with one empty line, so the first ingredient is one tap away.
      this.addRecipeRow();
    }
    this.loadOptions();
  }

  private seedFromProduct(): void {
    const product = this.product();
    if (!product) {
      return;
    }
    this.form.setValue({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? '',
      brand: product.brand ?? '',
      description: product.description ?? '',
      costPrice: Number(product.costPrice),
      sellingPrice: Number(product.sellingPrice),
      reorderPoint: product.reorderPoint,
      reorderUrl: product.reorderUrl ?? '',
      reorderPlatform: product.reorderPlatform,
      categoryId: product.categoryId,
      supplierId: product.supplierId,
      locationId: product.locationId,
      menuGroupId: product.menuGroupId,
      menuSizeLabel: product.menuSizeLabel ?? '',
    });
    // Respect a platform the product already carries: don't let URL auto-detect overwrite it.
    if (product.reorderPlatform) {
      this.platformPinned.set(true);
    }

    if (product.components.length > 0) {
      this.behaviour.set('recipe');
      this.recipeRows.clear();
      for (const line of product.components) {
        this.recipeRows.push(this.buildRecipeRow(line.component.id, line.quantity));
      }
    } else if (!product.isStockTracked) {
      this.behaviour.set('always');
    } else {
      this.behaviour.set('own-stock');
    }
  }

  private loadOptions(): void {
    this.optionsLoading.set(true);
    const product = this.product();

    // Load the master-data lists and the ingredient catalog together so optionsLoading
    // reflects all of them and a single error path covers every failure.
    forkJoin({
      categories: this.categories.list(),
      suppliers: this.suppliers.list(),
      locations: this.locations.list(),
      catalog: this.products.listAll(),
      menuGroups: this.menu.listGroups(),
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.optionsLoading.set(false)),
      )
      .subscribe({
        next: ({ categories, suppliers, locations, catalog, menuGroups }) => {
          this.categoryOptions.set(this.mergeCurrent(categories, product?.category ?? null));
          this.supplierOptions.set(this.mergeCurrent(suppliers, product?.supplier ?? null));
          this.locationOptions.set(this.mergeCurrent(locations, product?.location ?? null));
          this.ingredientOptions.set(this.toIngredientOptions(catalog, product));
          // The whole section stays hidden for a catalog with no drinks menu (lugawjuan).
          this.menuGroupOptions.set(menuGroups.map((group) => ({ id: group.id, name: group.name })));
        },
        error: (error: unknown) =>
          this.formError.set(httpErrorMessage(error)),
      });
  }

  /**
   * Everything the recipe may draw on: active, stock-tracked, non-recipe products (the backend
   * enforces the same rules), minus the product itself. Ingredients the current recipe already
   * uses stay pickable even if the catalog fetch no longer returns them.
   */
  private toIngredientOptions(catalog: Product[], product: Product | null): IngredientOption[] {
    const options = catalog
      .filter((item) => item.id !== product?.id && isComponentEligible(item))
      .map((item) => ({
        id: item.id,
        name: item.name,
        costPriceCents: Math.round(Number(item.costPrice) * 100),
        quantityOnHand: item.quantityOnHand,
      }));

    for (const line of product?.components ?? []) {
      if (!options.some((option) => option.id === line.component.id)) {
        options.unshift({
          id: line.component.id,
          name: line.component.name,
          costPriceCents: Math.round(Number(line.component.costPrice) * 100),
          quantityOnHand: line.component.quantityOnHand,
        });
      }
    }
    return options;
  }

  /**
   * Keep the product's current selection pickable even if the master list omits
   * it (e.g. an archived category the product still points at).
   */
  private mergeCurrent<T extends NamedRecord>(items: T[], current: T | null): NamedRecord[] {
    const list: NamedRecord[] = items.map(({ id, name }) => ({ id, name }));
    if (current && !list.some((item) => item.id === current.id)) {
      list.unshift({ id: current.id, name: current.name });
    }
    return list;
  }

  // --- Recipe rows ---

  private buildRecipeRow(componentId = '', quantity = 1): RecipeRowGroup {
    return this.formBuilder.nonNullable.group({
      componentId: [componentId, [Validators.required]],
      quantity: [quantity, [Validators.required, Validators.min(1), Validators.max(999)]],
    });
  }

  protected addRecipeRow(componentId = ''): void {
    this.recipeRows.push(this.buildRecipeRow(componentId));
  }

  protected removeRecipeRow(index: number): void {
    this.recipeRows.removeAt(index);
  }

  protected setBehaviour(value: StockBehaviour): void {
    this.behaviour.set(value);
    if (value === 'recipe' && this.recipeRows.length === 0) {
      this.addRecipeRow();
    }
  }

  /** Why the recipe can't save yet, or null when it's coherent. */
  private recipeIssue(): string | null {
    const rows = this.recipeRows.getRawValue();
    if (rows.length === 0) {
      return 'Add at least one ingredient to the recipe.';
    }
    if (rows.some((row) => !row.componentId)) {
      return 'Choose an ingredient for every recipe line.';
    }
    if (this.recipeRows.invalid) {
      return 'Every ingredient needs a quantity between 1 and 999.';
    }
    const ids = rows.map((row) => row.componentId);
    if (new Set(ids).size !== ids.length) {
      return 'The recipe lists the same ingredient twice.';
    }
    return null;
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set(this.validationMessage());
      return;
    }
    const behaviour = this.behaviour();
    if (behaviour === 'recipe') {
      const issue = this.recipeIssue();
      if (issue) {
        this.recipeRows.markAllAsTouched();
        this.formError.set(issue);
        return;
      }
    }

    const raw = this.form.getRawValue();
    const ownStock = behaviour === 'own-stock';
    // Platform is meaningless without a link, so only send it alongside one; stock and reorder
    // fields only mean something for an own-stock item.
    const reorderUrl = ownStock ? this.optional(raw.reorderUrl) ?? null : null;
    const body: ProductRequest = {
      name: raw.name.trim(),
      sku: raw.sku.trim(),
      description: this.optional(raw.description),
      barcode: this.optional(raw.barcode),
      brand: this.optional(raw.brand),
      costPrice: raw.costPrice ?? 0,
      sellingPrice: raw.sellingPrice ?? 0,
      reorderPoint: ownStock ? raw.reorderPoint ?? null : null,
      reorderUrl,
      reorderPlatform: reorderUrl ? raw.reorderPlatform ?? null : null,
      categoryId: raw.categoryId,
      supplierId: raw.supplierId || null,
      locationId: raw.locationId || null,
      // Detaching sends null; the label only means anything while a group is attached.
      menuGroupId: raw.menuGroupId || null,
      menuSizeLabel: raw.menuGroupId ? raw.menuSizeLabel.trim() : '',
      // This form authors the sellable menu; kitchen-only stock is created on /ingredients.
      isStockOnly: false,
      isStockTracked: behaviour !== 'always',
      components:
        behaviour === 'recipe'
          ? this.recipeRows.getRawValue().map((row) => ({
              componentId: row.componentId,
              quantity: Math.max(1, Math.floor(row.quantity)),
            }))
          : [],
    };

    const existing = this.product();
    const request$ = existing
      ? this.products.update(existing.id, body)
      : this.products.create(body);

    this.saving.set(true);
    this.formError.set(null);
    request$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (product) => this.saved.emit(product),
        error: (error: unknown) => this.formError.set(httpErrorMessage(error, `SKU "${body.sku}"`)),
      });
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  protected onEscape(): void {
    this.cancel();
  }

  /**
   * Fill the barcode with an internally generated, scannable code for products
   * that carry no manufacturer barcode. Uses the GS1 in-store prefix (2) so it
   * never collides with a real manufacturer GTIN, and a valid EAN-13 check digit
   * so any scanner reads it back cleanly. The SKU stays the product's identity;
   * this is purely a code to scan and print on a label. The server's unique
   * constraint is the final guard against the rare clash.
   */
  protected generateBarcode(): void {
    const seed = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const base = `2${seed.slice(-11).padStart(11, '0')}`;
    const barcode = `${base}${this.eanCheckDigit(base)}`;
    this.form.controls.barcode.setValue(barcode);
    this.form.controls.barcode.markAsDirty();
  }

  /** Mod-10 check digit for a 12-digit EAN-13 base (weights 1, 3 from the left). */
  private eanCheckDigit(base: string): string {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += i % 2 === 0 ? Number(base[i]) : Number(base[i]) * 3;
    }
    return String((10 - (sum % 10)) % 10);
  }

  protected createCategory(popover: Popover): void {
    this.runQuickCreate(this.quickCategoryName, (name) => this.categories.create({ name }), (created) => {
      this.categoryOptions.update((list) => [{ id: created.id, name: created.name }, ...list]);
      this.form.controls.categoryId.setValue(created.id);
      popover.hide();
    });
  }

  protected createSupplier(popover: Popover): void {
    this.runQuickCreate(this.quickSupplierName, (name) => this.suppliers.create({ name }), (created) => {
      this.supplierOptions.update((list) => [{ id: created.id, name: created.name }, ...list]);
      this.form.controls.supplierId.setValue(created.id);
      popover.hide();
    });
  }

  protected createLocation(popover: Popover): void {
    this.runQuickCreate(this.quickLocationName, (name) => this.locations.create({ name }), (created) => {
      this.locationOptions.update((list) => [{ id: created.id, name: created.name }, ...list]);
      this.form.controls.locationId.setValue(created.id);
      popover.hide();
    });
  }

  /**
   * Quick-create a kitchen ingredient without leaving the recipe: an isStockOnly product with a
   * generated SKU under the "Ingredients" category (created on first use). It starts at 0 on hand
   * and 0 cost — the owner stocks and prices it on the Ingredients page. The new ingredient drops
   * straight into the first empty recipe line, or a fresh one.
   */
  protected createIngredient(popover: Popover): void {
    const name = this.quickIngredientName.value.trim();
    this.quickError.set(null);
    if (!name) {
      this.quickError.set('Enter a name.');
      return;
    }
    if (this.quickBusy()) {
      return;
    }

    this.quickBusy.set(true);
    this.ensureIngredientsCategory()
      .pipe(
        switchMap((categoryId) =>
          this.products.create({
            name,
            sku: generateIngredientSku(name),
            costPrice: 0,
            sellingPrice: 0,
            categoryId,
            isStockOnly: true,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.quickBusy.set(false)),
      )
      .subscribe({
        next: (created) => {
          this.ingredientOptions.update((list) => [
            { id: created.id, name: created.name, costPriceCents: 0, quantityOnHand: 0 },
            ...list,
          ]);
          const emptyRow = this.recipeRows.controls.find(
            (row) => !row.controls.componentId.value,
          );
          if (emptyRow) {
            emptyRow.controls.componentId.setValue(created.id);
          } else {
            this.addRecipeRow(created.id);
          }
          this.quickIngredientName.reset('');
          popover.hide();
        },
        error: (error: unknown) => this.quickError.set(httpErrorMessage(error, `"${name}"`)),
      });
  }

  /** The per-tenant "Ingredients" category quick-created ingredients file under; created once. */
  private ensureIngredientsCategory(): Observable<string> {
    const existing = this.categoryOptions().find(
      (option) => option.name.trim().toLowerCase() === 'ingredients',
    );
    if (existing) {
      return of(existing.id);
    }
    return this.categories.create({ name: 'Ingredients' }).pipe(
      map((created) => {
        this.categoryOptions.update((list) => [...list, { id: created.id, name: created.name }]);
        return created.id;
      }),
    );
  }

  /** Reset a quick-create popover's transient state as it opens. */
  protected openQuick(control: FormControl<string>): void {
    this.quickError.set(null);
    control.reset('');
  }

  private runQuickCreate<T extends NamedRecord>(
    control: FormControl<string>,
    create: (name: string) => Observable<T>,
    onCreated: (created: T) => void,
  ): void {
    const name = control.value.trim();
    this.quickError.set(null);
    if (!name) {
      this.quickError.set('Enter a name.');
      return;
    }
    if (this.quickBusy()) {
      return;
    }

    this.quickBusy.set(true);
    create(name)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.quickBusy.set(false)),
      )
      .subscribe({
        next: (created) => {
          onCreated(created);
          control.reset('');
        },
        error: (error: unknown) => this.quickError.set(httpErrorMessage(error, `"${name}"`)),
      });
  }

  private optional(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private validationMessage(): string {
    const controls = this.form.controls;
    if (controls.name.invalid) {
      return 'A product name is required.';
    }
    if (controls.sku.invalid) {
      return 'A SKU is required.';
    }
    if (controls.categoryId.invalid) {
      return 'Choose a category for this product.';
    }
    if (controls.reorderUrl.invalid) {
      return 'Enter a valid reorder link starting with http:// or https://.';
    }
    return 'Check the highlighted fields and try again.';
  }
}
