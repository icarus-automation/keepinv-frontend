import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { PrinterError } from '../../../common/printing/label-printer';
import { MoneyPipe, formatPeso } from '../products/utils/money.pipe';
import { PosService } from './services/pos.service';
import { ReceiptPrintService } from './services/receipt-print.service';
import {
  PAYMENT_METHODS,
  PaymentMethod,
  PaymentMethodMeta,
  PosMenuFlavor,
  PosMenuGroup,
  PosMenuSize,
  PosSearchItem,
  ReceiptData,
  SaleResult,
  priceToCents,
} from './types/pos.types';
import { Receipt } from './components/receipt';
import { ProductGrid } from './components/product-grid/product-grid';
import { DrinkMenu, DrinkPick } from './components/drink-menu/drink-menu';

/**
 * One line in the working cart. A serialized unit carries a `productUnitId` and a
 * fixed quantity of 1, anchored by its `unitIdentifier`; a stock product is keyed
 * by `productId` and sold by quantity. Prices are held in integer centavos so the
 * running total never drifts off the backend's authoritative sum.
 */
interface CartLine {
  readonly key: string;
  readonly productId: string;
  readonly productUnitId?: string;
  readonly name: string;
  readonly sku: string;
  readonly unitIdentifier?: string;
  /** The flavor picked for a drinks line; the API requires it and the slip prints it. */
  readonly menuFlavorId?: string;
  readonly flavorName?: string;
  readonly unitPriceCents: number;
  quantity: number;
  readonly quantityOnHand: number;
  readonly isSerialized: boolean;
  /** false = always sellable (a refill): no meaningful count, so never warn about over-stock. */
  readonly isStockTracked: boolean;
}

/** A quick-tender chip: either a cash denomination to add, or "Exact" to match the total. */
interface TenderChip {
  readonly label: string;
  readonly kind: 'add' | 'exact';
  readonly amount?: number;
}

/** How long after a blur we wait before reclaiming focus to the scan field. */
const REFOCUS_DELAY_MS = 0;

/**
 * lugawjuan runs on a touch-only tablet with no barcode scanner, so the product grid
 * is the primary way to ring items up. With this false we suppress the scanner's
 * aggressive auto-focus — otherwise every tap on a card would summon the on-screen
 * keyboard. Flip to true to restore scanner-first focus for a scanner-equipped lane.
 */
const SCANNER_FIRST = false;

/**
 * The Point of Sale sell screen. Scanner-first and keyboard-first: the scan field
 * owns focus throughout (mirroring the commissioning sweep), so a scanned barcode,
 * serial, or asset tag always lands here. Enter resolves the scan against the
 * catalog and drops the matching item straight into the cart; ambiguous typing
 * opens a pick list instead. Totals compute in centavos. On checkout the whole cart
 * posts at once and the screen swaps to the receipt.
 */
@Component({
  selector: 'app-pos',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    MoneyPipe,
    Receipt,
    ProductGrid,
    DrinkMenu,
  ],
  templateUrl: './pos.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class Pos {
  private readonly service = inject(PosService);
  protected readonly printService = inject(ReceiptPrintService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly scanInput = viewChild<ElementRef<HTMLInputElement>>('scanInput');
  private readonly unitPickerPanel = viewChild<ElementRef<HTMLElement>>('unitPickerPanel');
  private readonly unitPickerList = viewChild<ElementRef<HTMLElement>>('unitPickerList');

  protected readonly phase = signal<'selling' | 'receipt'>('selling');

  // --- Product grid (touch-first quick-add) ---
  protected readonly gridProducts = signal<PosSearchItem[]>([]);
  protected readonly gridLoading = signal(true);
  protected readonly gridError = signal<string | null>(null);

  // --- Drinks menu (size → flavor ordering) ---
  /**
   * Non-empty for a tenant that defines menu groups (A Cup of Joy): the sell screen swaps the
   * product grid for the size/flavor picker. Lugawjuan defines none, so it stays on the grid —
   * that single check is the whole difference between the two counters.
   */
  protected readonly menuGroups = signal<PosMenuGroup[]>([]);
  protected readonly usesDrinkMenu = computed(() => this.menuGroups().length > 0);

  // --- Cart ---
  protected readonly cart = signal<CartLine[]>([]);
  private keySeq = 0;

  // --- Scan / search ---
  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly results = signal<PosSearchItem[]>([]);
  protected readonly resultsOpen = signal(false);
  protected readonly searching = signal(false);
  protected readonly highlighted = signal(0);
  /** A transient note under the field: a not-found miss or a duplicate-unit rejection. */
  protected readonly searchNotice = signal<string | null>(null);
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Unit picker (serialized products prompt for which physical unit to sell) ---
  /** The serialized product whose units are being chosen, or null when the picker is closed. */
  protected readonly unitPickerProduct = signal<PosSearchItem | null>(null);
  protected readonly unitPickerUnits = signal<PosSearchItem[]>([]);
  protected readonly unitPickerLoading = signal(false);
  protected readonly unitPickerError = signal<string | null>(null);
  protected readonly unitPickerHighlighted = signal(0);

  // --- Tender ---
  protected readonly methods: readonly PaymentMethodMeta[] = PAYMENT_METHODS;
  protected readonly method = signal<PaymentMethod>('CASH');
  protected readonly tenderControl = new FormControl<number | null>(null);
  protected readonly tenderChips: readonly TenderChip[] = [
    { label: 'Exact', kind: 'exact' },
    { label: '+100', kind: 'add', amount: 100 },
    { label: '+500', kind: 'add', amount: 500 },
    { label: '+1000', kind: 'add', amount: 1000 },
  ];
  private readonly tenderedValue = toSignal(this.tenderControl.valueChanges, {
    initialValue: this.tenderControl.value,
  });

  // --- Note / checkout ---
  protected readonly showNote = signal(false);
  protected readonly noteControl = new FormControl('', { nonNullable: true });
  protected readonly committing = signal(false);
  protected readonly checkoutError = signal<string | null>(null);
  protected readonly result = signal<SaleResult | null>(null);

  // --- Receipt printer (XP-58H over Web Bluetooth) ---
  /** A print/connect failure to surface inline; auto-print never blocks the sale itself. */
  protected readonly printNotice = signal<string | null>(null);
  protected readonly printBusy = computed(() => {
    const status = this.printService.status();
    return status === 'connecting' || status === 'printing';
  });
  /** The header chip: what tapping the printer button currently means. */
  protected readonly printerChip = computed(() => {
    switch (this.printService.status()) {
      case 'ready':
        return { icon: 'pi pi-print', label: this.printService.deviceName() ?? 'Printer ready' };
      case 'connecting':
        return { icon: 'pi pi-spin pi-spinner', label: 'Connecting…' };
      case 'printing':
        return { icon: 'pi pi-spin pi-spinner', label: 'Printing…' };
      default:
        return { icon: 'pi pi-print', label: 'Connect printer' };
    }
  });

  // --- Derived totals (centavos) ---
  protected readonly subtotalCents = computed(() =>
    this.cart().reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0),
  );
  protected readonly totalCents = this.subtotalCents;
  protected readonly itemCount = computed(() =>
    this.cart().reduce((sum, line) => sum + line.quantity, 0),
  );

  /** Cash is operator-entered; every other method tenders exactly the total. */
  protected readonly effectiveTenderedCents = computed(() =>
    this.method() === 'CASH'
      ? priceToCents(this.tenderedValue() ?? 0)
      : this.totalCents(),
  );
  protected readonly changeDueCents = computed(() =>
    Math.max(0, this.effectiveTenderedCents() - this.totalCents()),
  );

  protected readonly canComplete = computed(
    () =>
      !this.committing() &&
      this.cart().length > 0 &&
      this.totalCents() > 0 &&
      this.effectiveTenderedCents() >= this.totalCents(),
  );

  /** Why Complete is disabled, in counter-terse words. Null once the sale can go through. */
  protected readonly completeHint = computed(() => {
    if (this.cart().length === 0) {
      return 'Tap an item to begin.';
    }
    if (this.effectiveTenderedCents() < this.totalCents()) {
      return 'Enter the amount tendered.';
    }
    return null;
  });

  // Formatted strings for display (peso, tabular).
  protected readonly subtotalDisplay = computed(() => formatPeso(this.subtotalCents() / 100));
  protected readonly totalDisplay = computed(() => formatPeso(this.totalCents() / 100));
  protected readonly changeDueDisplay = computed(() => formatPeso(this.changeDueCents() / 100));

  constructor() {
    // Settled, distinct typing drives the live pick list. The scanner's Enter path
    // resolves separately and immediately, so it never waits on this debounce.
    this.searchControl.valueChanges
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.runLiveSearch(value.trim()));

    // Keep the scan field focused whenever we're selling, so an RFID/barcode sweep
    // always lands in it. The receipt phase releases focus to its own actions. On a
    // touch-only lane this is off, so tapping cards never pops the on-screen keyboard.
    effect(() => {
      const el = this.scanInput();
      if (SCANNER_FIRST && el && this.phase() === 'selling' && !this.unitPickerProduct()) {
        el.nativeElement.focus();
      }
    });

    // Move focus into the unit picker when it opens so arrow/Enter/Escape work: the
    // list takes focus once loaded, the panel holds it while units are still loading.
    effect(() => {
      if (!this.unitPickerProduct()) {
        return;
      }
      const target = this.unitPickerList() ?? this.unitPickerPanel();
      target?.nativeElement.focus();
    });

    this.destroyRef.onDestroy(() => {
      if (this.noticeTimer) {
        clearTimeout(this.noticeTimer);
      }
    });

    this.loadMenu();
    // Re-link the remembered printer so the first sale of the day auto-prints without a tap.
    void this.printService.reconnectSilently();
  }

  // --- Menu / product grid ---

  /**
   * Ask for the drinks menu first. A tenant that defines groups orders off the picker and never
   * needs the product grid — and must not see it, since every drink size demands a flavor the
   * grid can't supply. Only when the menu comes back empty do we fall back to loading the grid.
   */
  protected loadMenu(): void {
    this.gridLoading.set(true);
    this.gridError.set(null);
    this.service
      .getMenu()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (groups) => {
          this.menuGroups.set(groups);
          if (groups.length > 0) {
            this.gridLoading.set(false);
            return;
          }
          this.loadGrid();
        },
        error: (error: unknown) => {
          this.gridError.set(httpErrorMessage(error));
          this.gridLoading.set(false);
        },
      });
  }

  /** Load (or reload) the whole sellable catalog for the touch grid. */
  protected loadGrid(): void {
    this.gridLoading.set(true);
    this.gridError.set(null);
    this.service
      .listSellableProducts()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.gridLoading.set(false)),
      )
      .subscribe({
        next: (items) => this.gridProducts.set(items),
        error: (error: unknown) => this.gridError.set(httpErrorMessage(error)),
      });
  }

  /**
   * Add one drink from the menu picker. Lines are keyed by size *and* flavor, so a Taro and an
   * Ube of the same size stay two lines instead of collapsing into a single "2x" the kitchen
   * would misread — the API keys its own merge the same way.
   */
  protected addDrink(pick: DrinkPick): void {
    const { group, size, flavor } = pick;
    if (!size.isSellable || !flavor.isAvailable) {
      this.flagNotice(`${flavor.name} is not available right now.`);
      return;
    }

    const index = this.cart().findIndex(
      (line) => line.productId === size.productId && line.menuFlavorId === flavor.id,
    );
    if (index >= 0) {
      this.cart.update((lines) =>
        lines.map((line, i) => (i === index ? { ...line, quantity: line.quantity + 1 } : line)),
      );
    } else {
      this.cart.update((lines) => [this.drinkLine(group, size, flavor), ...lines]);
    }
    this.checkoutError.set(null);
  }

  private drinkLine(group: PosMenuGroup, size: PosMenuSize, flavor: PosMenuFlavor): CartLine {
    return {
      key: `c${this.keySeq++}`,
      productId: size.productId,
      // Mirrors the seeded product name ("Milktea (16oz)") so cart, receipt and slip all agree.
      name: `${group.name} (${size.label})`,
      sku: '',
      menuFlavorId: flavor.id,
      flavorName: flavor.name,
      unitPriceCents: priceToCents(size.sellingPrice) + priceToCents(flavor.priceDelta),
      quantity: 1,
      quantityOnHand: size.available,
      isSerialized: false,
      isStockTracked: size.isStockTracked,
    };
  }

  // --- Scan / search ---

  private runLiveSearch(term: string): void {
    if (!term) {
      this.results.set([]);
      this.resultsOpen.set(false);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.service
      .searchItems(term)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.results.set(items);
          this.highlighted.set(this.firstSelectableIndex(items));
          this.resultsOpen.set(items.length > 0);
          this.searching.set(false);
        },
        error: () => this.searching.set(false),
      });
  }

  /** Enter from the scan field: add the highlighted pick, else resolve the raw token. */
  protected onScanEnter(event: Event): void {
    event.preventDefault();
    const term = this.searchControl.value.trim();
    if (!term) {
      return;
    }
    const results = this.results();
    if (this.resultsOpen() && results.length) {
      const pick = results[this.highlighted()];
      if (pick && this.canSelect(pick)) {
        this.addItem(pick);
        return;
      }
    }
    this.resolveAndAdd(term);
  }

  /**
   * The scanner fast path: look the token up immediately and, if it resolves to one
   * sellable thing (an exact identifier match or a lone hit), drop it in the cart.
   * Anything ambiguous opens the pick list instead of guessing.
   */
  private resolveAndAdd(term: string): void {
    this.searching.set(true);
    this.service
      .searchItems(term, 10)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.searching.set(false)),
      )
      .subscribe({
        next: (items) => {
          const exact = items.find((item) => item.isSellable && this.identifierMatches(item, term));
          if (exact) {
            this.addItem(exact);
            return;
          }
          const sellable = items.filter((item) => item.isSellable);
          if (sellable.length === 1) {
            this.addItem(sellable[0]);
            return;
          }
          // A scanned model barcode that lands on one serialized product → prompt for its unit.
          const pickable = items.filter((item) => this.needsUnitPick(item));
          if (sellable.length === 0 && pickable.length === 1) {
            this.openUnitPicker(pickable[0]);
            return;
          }
          if (items.length === 0) {
            this.flagNotice(`No item found for "${term}".`);
            this.results.set([]);
            this.resultsOpen.set(false);
            return;
          }
          this.results.set(items);
          this.highlighted.set(this.firstSelectableIndex(items));
          this.resultsOpen.set(true);
        },
        error: (error: unknown) => this.flagNotice(httpErrorMessage(error)),
      });
  }

  private identifierMatches(item: PosSearchItem, term: string): boolean {
    const needle = term.toLowerCase();
    return (
      item.barcode?.toLowerCase() === needle ||
      item.sku.toLowerCase() === needle ||
      item.unitIdentifier?.toLowerCase() === needle
    );
  }

  private firstSelectableIndex(items: PosSearchItem[]): number {
    const index = items.findIndex((item) => this.canSelect(item));
    return index === -1 ? 0 : index;
  }

  /** A serialized product with stock isn't sold directly — selecting it prompts for a unit. */
  protected needsUnitPick(item: PosSearchItem): boolean {
    return item.kind === 'PRODUCT' && item.isSerialized && item.quantityOnHand > 0;
  }

  /** A row is actionable when it's directly sellable or a serialized product to drill into. */
  protected canSelect(item: PosSearchItem): boolean {
    return item.isSellable || this.needsUnitPick(item);
  }

  protected moveHighlight(delta: number, event: Event): void {
    if (!this.resultsOpen() || this.results().length === 0) {
      return;
    }
    event.preventDefault();
    const count = this.results().length;
    this.highlighted.update((current) => (current + delta + count) % count);
  }

  protected highlight(index: number): void {
    this.highlighted.set(index);
  }

  protected closeResults(): void {
    this.resultsOpen.set(false);
  }

  protected onScanBlur(): void {
    if (!SCANNER_FIRST) {
      return;
    }
    // Reclaim focus only if it fell to nothing; never steal it from a real control
    // (a result button, a tender field). Mirrors the commissioning sweep.
    setTimeout(() => {
      const el = this.scanInput()?.nativeElement;
      const active = document.activeElement;
      if (el && this.phase() === 'selling' && (active === document.body || active === null)) {
        el.focus();
      }
    }, REFOCUS_DELAY_MS);
  }

  protected optionId(index: number): string {
    return `pos-result-${index}`;
  }

  // --- Cart ---

  protected addItem(item: PosSearchItem): void {
    if (this.needsUnitPick(item)) {
      this.openUnitPicker(item);
      return;
    }
    if (!item.isSellable) {
      this.flagNotice(`${item.name} is not available to sell.`);
      return;
    }

    if (item.productUnitId) {
      if (this.cart().some((line) => line.productUnitId === item.productUnitId)) {
        this.flagNotice(`${item.unitIdentifier ?? 'That unit'} is already in the cart.`);
        this.afterAdd();
        return;
      }
      this.cart.update((lines) => [this.unitLine(item), ...lines]);
      this.afterAdd();
      return;
    }

    const index = this.cart().findIndex(
      (line) => line.productId === item.productId && !line.productUnitId,
    );
    if (index >= 0) {
      this.cart.update((lines) =>
        lines.map((line, i) => (i === index ? { ...line, quantity: line.quantity + 1 } : line)),
      );
    } else {
      this.cart.update((lines) => [this.productLine(item), ...lines]);
    }
    this.afterAdd();
  }

  private productLine(item: PosSearchItem): CartLine {
    return {
      key: `c${this.keySeq++}`,
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      unitPriceCents: priceToCents(item.sellingPrice),
      quantity: 1,
      quantityOnHand: item.quantityOnHand,
      isSerialized: false,
      isStockTracked: item.isStockTracked,
    };
  }

  private unitLine(item: PosSearchItem): CartLine {
    return {
      key: `c${this.keySeq++}`,
      productId: item.productId,
      productUnitId: item.productUnitId,
      name: item.name,
      sku: item.sku,
      unitIdentifier: item.unitIdentifier,
      unitPriceCents: priceToCents(item.sellingPrice),
      quantity: 1,
      quantityOnHand: item.quantityOnHand,
      isSerialized: true,
      isStockTracked: true,
    };
  }

  /** Clear the field, close the pick list, and hand focus back to the scanner. */
  private afterAdd(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.results.set([]);
    this.resultsOpen.set(false);
    this.checkoutError.set(null);
    this.refocus();
  }

  // --- Unit picker ---

  /**
   * Open the unit picker for a serialized product and load its sellable units. The
   * cashier chooses which physical unit leaves the shelf; that exact serial is what
   * gets sold, so every sale still maps to a specific unit. Units already in the cart
   * are filtered out so they can't be double-added.
   */
  private openUnitPicker(product: PosSearchItem): void {
    this.unitPickerProduct.set(product);
    this.unitPickerUnits.set([]);
    this.unitPickerError.set(null);
    this.unitPickerHighlighted.set(0);
    this.unitPickerLoading.set(true);
    this.results.set([]);
    this.resultsOpen.set(false);
    this.searchControl.setValue('', { emitEvent: false });

    this.service
      .listAvailableUnits(product.productId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.unitPickerLoading.set(false)),
      )
      .subscribe({
        next: (units) => {
          const inCart = new Set(
            this.cart()
              .map((line) => line.productUnitId)
              .filter((id): id is string => !!id),
          );
          const available = units.filter(
            (unit) => unit.isSellable && !!unit.productUnitId && !inCart.has(unit.productUnitId),
          );
          this.unitPickerUnits.set(available);
          if (available.length === 0) {
            this.unitPickerError.set('No available units left for this product.');
          }
        },
        error: (error: unknown) => this.unitPickerError.set(httpErrorMessage(error)),
      });
  }

  /** Add the chosen unit to the cart and close the picker. */
  protected pickUnit(unit: PosSearchItem): void {
    this.closeUnitPicker();
    this.addItem(unit);
  }

  /** Pick the currently highlighted unit (Enter from the picker). */
  protected pickHighlightedUnit(event: Event): void {
    event.preventDefault();
    const unit = this.unitPickerUnits()[this.unitPickerHighlighted()];
    if (unit) {
      this.pickUnit(unit);
    }
  }

  /** Roving highlight inside the unit picker (Arrow keys). */
  protected moveUnitHighlight(delta: number, event: Event): void {
    const count = this.unitPickerUnits().length;
    if (count === 0) {
      return;
    }
    event.preventDefault();
    this.unitPickerHighlighted.update((current) => (current + delta + count) % count);
  }

  protected setUnitHighlight(index: number): void {
    this.unitPickerHighlighted.set(index);
  }

  /** Dismiss the unit picker and return focus to the scanner. */
  protected closeUnitPicker(): void {
    this.unitPickerProduct.set(null);
    this.unitPickerUnits.set([]);
    this.unitPickerError.set(null);
    this.unitPickerHighlighted.set(0);
    this.refocus();
  }

  protected unitOptionId(index: number): string {
    return `pos-unit-${index}`;
  }

  protected increment(key: string): void {
    this.cart.update((lines) =>
      lines.map((line) =>
        line.key === key && !line.isSerialized ? { ...line, quantity: line.quantity + 1 } : line,
      ),
    );
    this.refocus();
  }

  protected decrement(key: string): void {
    this.cart.update((lines) =>
      lines.map((line) =>
        line.key === key && !line.isSerialized && line.quantity > 1
          ? { ...line, quantity: line.quantity - 1 }
          : line,
      ),
    );
    this.refocus();
  }

  /**
   * Set a stock line's quantity from a typed value, so 100 units is one entry, not a
   * hundred taps. Anything that isn't a whole number ≥ 1 snaps back to 1, and the input
   * is re-synced to the accepted value. Serialized (per-unit) lines stay fixed at 1.
   */
  protected setQuantity(key: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const parsed = Math.floor(Number(input.value));
    const quantity = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    this.cart.update((lines) =>
      lines.map((line) =>
        line.key === key && !line.isSerialized ? { ...line, quantity } : line,
      ),
    );
    // Reflect the normalized value even when the model didn't change (e.g. "abc" on a line
    // already at 1), so the field never shows an invalid entry.
    input.value = String(quantity);
    this.refocus();
  }

  /** Select the whole quantity on focus so a typed count overwrites rather than appends. */
  protected selectQuantity(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected removeLine(key: string): void {
    this.cart.update((lines) => lines.filter((line) => line.key !== key));
    this.refocus();
  }

  protected clearCart(): void {
    this.cart.set([]);
    this.checkoutError.set(null);
    this.refocus();
  }

  /**
   * Warn before the counter finds out at checkout. Every flavor of one size draws the same cup
   * pool, so the whole size's demand counts against it — three Taro plus three Ube of the 16oz
   * is six cups, even though neither line alone looks over.
   */
  protected overStock(line: CartLine): boolean {
    if (!line.isStockTracked || line.isSerialized) {
      return false;
    }
    const demandOnSameStock = this.cart()
      .filter((row) => row.productId === line.productId && !row.productUnitId)
      .reduce((sum, row) => sum + row.quantity, 0);
    return demandOnSameStock > line.quantityOnHand;
  }

  protected lineTotal(line: CartLine): string {
    return formatPeso((line.unitPriceCents * line.quantity) / 100);
  }

  protected unitPrice(line: CartLine): string {
    return formatPeso(line.unitPriceCents / 100);
  }

  // --- Tender ---

  protected setMethod(method: PaymentMethod): void {
    this.method.set(method);
    if (method !== 'CASH') {
      // Non-cash tenders the exact total; clear any stale cash figure.
      this.tenderControl.setValue(null, { emitEvent: false });
    }
    this.refocus();
  }

  protected applyTenderChip(chip: TenderChip): void {
    if (chip.kind === 'exact') {
      this.tenderControl.setValue(this.totalCents() / 100);
      return;
    }
    const current = this.tenderControl.value ?? 0;
    this.tenderControl.setValue(current + (chip.amount ?? 0));
  }

  protected toggleNote(): void {
    this.showNote.update((open) => !open);
  }

  // --- Checkout ---

  protected checkout(): void {
    if (!this.canComplete()) {
      return;
    }
    this.committing.set(true);
    this.checkoutError.set(null);

    this.service
      .checkout({
        items: this.cart().map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          menuFlavorId: line.menuFlavorId,
          quantity: line.quantity,
        })),
        paymentMethod: this.method(),
        amountTendered: this.effectiveTenderedCents() / 100,
        note: this.noteControl.value.trim() || undefined,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.committing.set(false)),
      )
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.phase.set('receipt');
          this.autoPrint(result.receiptData);
        },
        error: (error: unknown) => this.checkoutError.set(httpErrorMessage(error)),
      });
  }

  // --- Receipt printing ---

  /** Pair (or switch) the printer. The chip is the one tap that satisfies the gesture rule. */
  protected connectPrinter(): void {
    if (this.printBusy()) {
      return;
    }
    this.printNotice.set(null);
    void this.printService.connect().catch((error: unknown) => this.flagPrintError(error));
  }

  /**
   * Fire-and-forget after checkout: the kitchen slip only, so the kitchen starts the order at
   * once. The customer's number stub is a separate on-demand tap. A failure only posts an inline
   * notice — the sale is already committed and must never look blocked by paper.
   */
  private autoPrint(receipt: ReceiptData): void {
    if (!this.printService.supported) {
      return;
    }
    this.printNotice.set(null);
    void this.printService.printSlip(receipt).catch((error: unknown) => this.flagPrintError(error));
  }

  /** Reprint the kitchen slip for the sale on screen (a jam, a lost slip). */
  protected reprintSlip(): void {
    const receipt = this.result()?.receiptData;
    if (!receipt || this.printBusy()) {
      return;
    }
    this.printNotice.set(null);
    void this.printService
      .printSlipInteractive(receipt)
      .catch((error: unknown) => this.flagPrintError(error));
  }

  /** Print the customer's number stub — the staff's usual next tap after the kitchen slip. */
  protected printStub(): void {
    const receipt = this.result()?.receiptData;
    if (!receipt || this.printBusy()) {
      return;
    }
    this.printNotice.set(null);
    void this.printService
      .printStubInteractive(receipt)
      .catch((error: unknown) => this.flagPrintError(error));
  }

  /** Fallback for a driver-installed printer (USB to a PC): the browser's own print dialog. */
  protected systemPrint(): void {
    window.print();
  }

  private flagPrintError(error: unknown): void {
    if (error instanceof PrinterError && error.cancelled) {
      return;
    }
    this.printNotice.set(
      error instanceof Error ? error.message : 'Could not reach the printer.',
    );
  }

  /** Start a fresh sale, keeping the operator on the scan field. */
  protected newSale(): void {
    this.cart.set([]);
    this.searchControl.setValue('', { emitEvent: false });
    this.results.set([]);
    this.resultsOpen.set(false);
    this.method.set('CASH');
    this.tenderControl.setValue(null, { emitEvent: false });
    this.noteControl.setValue('', { emitEvent: false });
    this.showNote.set(false);
    this.checkoutError.set(null);
    this.searchNotice.set(null);
    this.printNotice.set(null);
    this.result.set(null);
    this.phase.set('selling');
    // Cups moved on the last sale; pull a fresh menu (or grid) so availability reflects it.
    this.loadMenu();
  }

  private refocus(): void {
    if (SCANNER_FIRST && this.phase() === 'selling') {
      this.scanInput()?.nativeElement.focus();
    }
  }

  private flagNotice(message: string): void {
    this.searchNotice.set(message);
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
    }
    this.noticeTimer = setTimeout(() => this.searchNotice.set(null), 2600);
  }
}
