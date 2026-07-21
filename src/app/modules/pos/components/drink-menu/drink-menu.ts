import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { formatPeso } from '../../../products/utils/money.pipe';
import { categoryColor } from '../../../../../common/theme/category-palette';
import { PosMenuFlavor, PosMenuGroup, PosMenuSize, priceToCents } from '../../types/pos.types';

/** What one tap on a flavor tile means: this flavor, at the size currently selected. */
export interface DrinkPick {
  readonly group: PosMenuGroup;
  readonly size: PosMenuSize;
  readonly flavor: PosMenuFlavor;
}

/**
 * The drinks ordering menu: pick a line (Milktea / Coffee / Hot Tea), pick a size, then tap a
 * flavor. The size is sticky per line, so three milkteas of the same size is one size tap and
 * three flavor taps — the common counter case. Each flavor tile prints the price it will actually
 * ring up at (size + the flavor's surcharge), so the cashier never has to do the arithmetic the
 * premium flavors would otherwise demand.
 *
 * Purely presentational: it owns the selection, not the cart. A tap emits the exact
 * group/size/flavor triple and the POS screen runs the same add path a grid tap would.
 * Sold-out flavors and out-of-stock sizes render dimmed and cannot be tapped.
 */
@Component({
  selector: 'app-drink-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (groups().length > 1) {
      <div role="tablist" aria-label="Menu" class="flex flex-wrap gap-2">
        @for (group of groups(); track group.id) {
          <button
            type="button"
            role="tab"
            [id]="tabId(group.id)"
            [attr.aria-selected]="group.id === activeGroup()?.id"
            [attr.aria-controls]="panelId(group.id)"
            [tabindex]="group.id === activeGroup()?.id ? 0 : -1"
            (click)="selectGroup(group.id)"
            (keydown.arrowright)="moveGroup(1, $event)"
            (keydown.arrowleft)="moveGroup(-1, $event)"
            class="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
            [class]="
              group.id === activeGroup()?.id
                ? 'border-ink bg-ink text-counter'
                : 'border-line bg-counter text-muted hover:text-ink'
            "
          >
            <span
              class="h-2.5 w-2.5 rounded-[3px]"
              [style.background-color]="color(group.name)"
              aria-hidden="true"
            ></span>
            {{ group.name }}
          </button>
        }
      </div>
    }

    @if (activeGroup(); as group) {
      <section
        [id]="panelId(group.id)"
        role="tabpanel"
        [attr.aria-labelledby]="groups().length > 1 ? tabId(group.id) : null"
        [class]="groups().length > 1 ? 'mt-5' : ''"
      >
        <!-- Sizes: sticky per line, so repeat orders of one size are a single tap each -->
        @if (group.sizes.length > 0) {
          <fieldset>
            <legend class="text-xs font-bold uppercase tracking-[0.14em] text-muted">Size</legend>
            <div class="mt-2.5 flex flex-wrap gap-2" role="radiogroup" [attr.aria-label]="group.name + ' size'">
              @for (size of group.sizes; track size.productId) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="size.productId === activeSize()?.productId"
                  [disabled]="!size.isSellable"
                  (click)="selectSize(group.id, size.productId)"
                  class="flex min-w-[7rem] flex-col items-start gap-0.5 rounded-lg border px-4 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-45"
                  [class]="
                    size.productId === activeSize()?.productId
                      ? 'border-signal bg-signal/10 text-ink'
                      : 'border-line bg-counter text-muted hover:border-signal hover:text-ink'
                  "
                >
                  <span class="text-sm font-semibold">{{ size.label }}</span>
                  <span class="text-xs font-medium tabular-nums">{{ price(size) }}</span>
                  @if (!size.isSellable) {
                    <span class="text-[0.7rem] font-semibold uppercase tracking-wide text-danger">
                      Out of cups
                    </span>
                  } @else if (size.isStockTracked && size.available <= lowCupWarning) {
                    <span class="text-[0.7rem] font-medium tabular-nums text-danger">
                      {{ size.available }} left
                    </span>
                  }
                </button>
              }
            </div>
          </fieldset>
        }

        <!-- Flavors: one tap adds the drink at the selected size -->
        <div class="mt-6">
          <h3 class="text-xs font-bold uppercase tracking-[0.14em] text-muted">Flavor</h3>

          @if (activeSize(); as size) {
            <ul class="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              @for (flavor of group.flavors; track flavor.id) {
                <li class="flex">
                  <button
                    type="button"
                    [disabled]="!flavor.isAvailable || !size.isSellable"
                    (click)="pick(group, size, flavor)"
                    [attr.aria-label]="
                      flavor.name + ' ' + group.name + ' ' + size.label + ', ' + linePrice(size, flavor)
                    "
                    [style.border-left-color]="color(group.name)"
                    class="group flex h-full min-h-[6.5rem] w-full flex-col justify-between gap-3 rounded-xl border border-l-4 border-line bg-counter p-4 text-left outline-none transition-colors hover:border-signal focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line"
                  >
                    <span class="block line-clamp-3 text-base font-semibold leading-snug text-ink">
                      {{ flavor.name }}
                    </span>
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="text-base font-bold tabular-nums text-ink">
                        {{ linePrice(size, flavor) }}
                      </span>
                      @if (!flavor.isAvailable) {
                        <span class="shrink-0 text-xs font-semibold uppercase tracking-wide text-danger">
                          Sold out
                        </span>
                      }
                    </div>
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="mt-2 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              No sizes are set up for {{ group.name }} yet.
            </p>
          }
        </div>
      </section>
    }
  `,
})
export class DrinkMenu {
  readonly groups = input.required<PosMenuGroup[]>();
  readonly pickDrink = output<DrinkPick>();

  /** Below this many servings the size button warns, so staff refill cups before running dry. */
  protected readonly lowCupWarning = 10;

  private readonly requestedGroupId = signal<string | null>(null);
  private readonly requestedSizeByGroup = signal<Record<string, string>>({});

  /** The open line; falls back to the first one whenever the request no longer resolves. */
  protected readonly activeGroup = computed<PosMenuGroup | null>(() => {
    const groups = this.groups();
    return groups.find((group) => group.id === this.requestedGroupId()) ?? groups[0] ?? null;
  });

  /** The chosen size, defaulting to the first one that can still be sold. */
  protected readonly activeSize = computed<PosMenuSize | null>(() => {
    const group = this.activeGroup();
    if (!group) {
      return null;
    }
    const requested = this.requestedSizeByGroup()[group.id];
    return (
      group.sizes.find((size) => size.productId === requested) ??
      group.sizes.find((size) => size.isSellable) ??
      group.sizes[0] ??
      null
    );
  });

  protected selectGroup(groupId: string): void {
    this.requestedGroupId.set(groupId);
  }

  protected selectSize(groupId: string, productId: string): void {
    this.requestedSizeByGroup.update((current) => ({ ...current, [groupId]: productId }));
  }

  /** Roving tab focus across the menu lines (WCAG tablist keyboard pattern). */
  protected moveGroup(delta: number, event: Event): void {
    const groups = this.groups();
    if (groups.length === 0) {
      return;
    }
    event.preventDefault();
    const current = groups.findIndex((group) => group.id === this.activeGroup()?.id);
    const next = groups[(current + delta + groups.length) % groups.length];
    this.requestedGroupId.set(next.id);
    document.getElementById(this.tabId(next.id))?.focus();
  }

  protected pick(group: PosMenuGroup, size: PosMenuSize, flavor: PosMenuFlavor): void {
    if (!flavor.isAvailable || !size.isSellable) {
      return;
    }
    this.pickDrink.emit({ group, size, flavor });
  }

  protected price(size: PosMenuSize): string {
    return formatPeso(priceToCents(size.sellingPrice) / 100);
  }

  /** What this flavor at this size actually rings up at — the size price plus its surcharge. */
  protected linePrice(size: PosMenuSize, flavor: PosMenuFlavor): string {
    return formatPeso((priceToCents(size.sellingPrice) + priceToCents(flavor.priceDelta)) / 100);
  }

  protected color(name: string): string {
    return categoryColor(name.trim().toLowerCase() || 'menu');
  }

  protected tabId(groupId: string): string {
    return `pos-menu-tab-${groupId}`;
  }

  protected panelId(groupId: string): string {
    return `pos-menu-panel-${groupId}`;
  }
}
