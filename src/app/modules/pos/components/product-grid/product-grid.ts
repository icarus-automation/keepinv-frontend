import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { MoneyPipe } from '../../../products/utils/money.pipe';
import { categoryColor } from '../../../../../common/theme/category-palette';
import { PosSearchItem } from '../../types/pos.types';

/** Menu order for the section headers (lugawjuan): bowls first, then refills, extras, drinks. */
const SECTION_ORDER = ['lugaw', 'refill', 'extras', 'drinks'];

/** A named run of tiles rendered under one warm section header. */
interface GridSection {
  name: string;
  items: PosSearchItem[];
}

/**
 * The touch-first product grid for the lugawjuan POS. Instead of photos, each product is a
 * typographic "menu chip" the cashier taps to drop straight into the cart — no scan, no search.
 * Tiles are grouped into warm-headed category sections (Lugaw, Refill, Extras, Drinks) so a big
 * thumb finds the right bowl fast; within a section every tile shares one height so rows stay even.
 * Purely presentational: it owns no data or cart logic, emits the tapped item, and lets the POS
 * screen run the same `addItem` path a scan would. A sold-out tile is dimmed and un-tappable;
 * an always-sellable refill never shows a count.
 */
@Component({
  selector: 'app-product-grid',
  imports: [MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (section of sections(); track section.name) {
      <section class="mb-7 last:mb-0">
        @if (showHeaders()) {
          <h3 class="mb-3.5 flex items-center gap-3">
            <span
              class="h-3 w-3 rounded-[4px]"
              [style.background-color]="color(section.name)"
              aria-hidden="true"
            ></span>
            <span class="text-sm font-bold uppercase tracking-[0.14em] text-ink">{{ section.name }}</span>
            <span class="h-px flex-1 bg-line" aria-hidden="true"></span>
          </h3>
        }

        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          @for (item of section.items; track item.productId) {
            <li class="flex">
              <button
                type="button"
                [disabled]="!item.isSellable"
                (click)="onSelect(item)"
                [attr.aria-label]="item.name + ', ' + (item.sellingPrice | money)"
                [style.border-left-color]="color(item.categoryName ?? section.name)"
                class="group flex h-full min-h-[8.5rem] w-full flex-col justify-between gap-4 rounded-xl border border-l-4 border-line bg-counter p-4 text-left outline-none transition-colors hover:border-signal focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line"
              >
                <span class="block line-clamp-3 text-lg font-semibold leading-snug text-ink">
                  {{ item.name }}
                </span>

                <div>
                  <span class="block h-px w-8 bg-line transition-colors group-hover:bg-signal/50" aria-hidden="true"></span>
                  <div class="mt-2.5 flex items-baseline justify-between gap-2">
                    <span class="text-lg font-bold tabular-nums text-ink">{{ item.sellingPrice | money }}</span>
                    @if (!item.isSellable) {
                      <span class="shrink-0 text-xs font-semibold uppercase tracking-wide text-danger">
                        Out
                      </span>
                    }
                  </div>
                </div>
              </button>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class ProductGrid {
  readonly products = input.required<PosSearchItem[]>();
  readonly itemClick = output<PosSearchItem>();

  /** Group tiles into ordered category sections; unknown categories fall to the end, name-sorted. */
  protected readonly sections = computed<GridSection[]>(() => {
    const groups = new Map<string, PosSearchItem[]>();
    for (const item of this.products()) {
      const name = item.categoryName?.trim() || 'Menu';
      const list = groups.get(name);
      if (list) {
        list.push(item);
      } else {
        groups.set(name, [item]);
      }
    }

    return Array.from(groups, ([name, items]) => ({ name, items })).sort((a, b) => {
      const rankA = this.sectionRank(a.name);
      const rankB = this.sectionRank(b.name);
      return rankA === rankB ? a.name.localeCompare(b.name) : rankA - rankB;
    });
  });

  /** Headers only earn their space once the menu spans more than one section. */
  protected readonly showHeaders = computed(() => this.sections().length > 1);

  private sectionRank(name: string): number {
    const index = SECTION_ORDER.indexOf(name.toLowerCase());
    return index === -1 ? SECTION_ORDER.length : index;
  }

  /**
   * A stable warm accent for a menu category, painted as each tile's left edge (and its section
   * header key). Keyed off the trimmed, lower-cased category name so every tile in a section shares
   * one color and the counter can find the right group by color at a glance. Falls back to "Menu"
   * for uncategorized items, matching the section grouping above.
   */
  protected color(key: string | null | undefined): string {
    return categoryColor(key?.trim().toLowerCase() || 'menu');
  }

  protected onSelect(item: PosSearchItem): void {
    if (!item.isSellable) {
      return;
    }
    this.itemClick.emit(item);
  }
}
