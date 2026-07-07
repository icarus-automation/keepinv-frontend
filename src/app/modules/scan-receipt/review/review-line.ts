import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { FormsModule } from '@angular/forms';

import { ProductsService } from '../../products/services/products.service';
import { MatchedProduct } from '../types/receipt-import.types';
import { ReviewLine } from './review-line.model';

/** Lightweight slice of a catalog product used by the manual-link search results. */
interface SearchHit {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  quantityOnHand: number;
  isSerialized: boolean;
}

/**
 * One receipt line in the review list: status, inline name/qty/cost edits, and — expanded —
 * the resolution panel (accept a fuzzy suggestion, link any catalog product, or create new).
 * The parent owns the state; this component only emits updated copies.
 */
@Component({
  selector: 'app-review-line',
  imports: [CurrencyPipe, DecimalPipe, FormsModule, ButtonModule, CheckboxModule, InputNumberModule, InputTextModule],
  templateUrl: './review-line.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewLineRow {
  private readonly products = inject(ProductsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly line = input.required<ReviewLine>();
  /** ISO 4217 code used for money on this receipt (falls back to PHP upstream). */
  readonly currency = input.required<string>();
  readonly update = output<ReviewLine>();

  protected readonly searchTerm = signal('');
  protected readonly searching = signal(false);
  protected readonly searchResults = signal<SearchHit[]>([]);
  protected readonly searchFailed = signal(false);
  private readonly search$ = new Subject<string>();

  protected readonly lineTotal = computed(() => this.line().quantity * this.line().unitCost);

  /** Chip text + tone per current resolution, not the original OCR status. */
  protected readonly chip = computed<{ label: string; classes: string }>(() => {
    const line = this.line();
    if (line.rejected) {
      return { label: 'Unreadable', classes: 'border-danger/30 bg-danger/10 text-danger' };
    }
    if (!line.included) {
      return { label: 'Skipped', classes: 'border-line bg-panel text-muted' };
    }
    switch (line.resolution) {
      case 'matched':
        return { label: 'Matched', classes: 'border-success/30 bg-success/10 text-success' };
      case 'linked':
        return { label: 'Linked', classes: 'border-success/30 bg-success/10 text-success' };
      case 'new':
        return { label: 'New product', classes: 'border-field/60 bg-counter text-ink' };
      default:
        return { label: 'Needs review', classes: 'border-signal/50 bg-signal/10 text-ink' };
    }
  });

  protected readonly resolutionSummary = computed(() => {
    const line = this.line();
    const product = line.linkedProduct;
    switch (line.resolution) {
      case 'matched':
      case 'linked': {
        if (!product) return '';
        const base = `Adds stock to ${product.name} (${product.sku})`;
        return product.isSerialized
          ? `${base} · serialized: ${line.quantity} untagged unit${line.quantity === 1 ? '' : 's'} will be created`
          : base;
      }
      case 'new':
        return line.trackSerials
          ? 'A new serialized product will be created — units get RFID tags later'
          : 'A new product will be created, then stocked';
      default:
        return this.line().scan.match.reason;
    }
  });

  constructor() {
    this.search$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((term) => {
          const query = term.trim();
          if (query.length < 2) {
            this.searching.set(false);
            return of<SearchHit[]>([]);
          }
          this.searching.set(true);
          this.searchFailed.set(false);
          return this.products.list({ page: 1, limit: 6, search: query }).pipe(
            switchMap((page) => of(page.items as SearchHit[])),
            catchError(() => {
              this.searchFailed.set(true);
              return of<SearchHit[]>([]);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        this.searching.set(false);
        this.searchResults.set(results);
      });
  }

  protected onSearch(term: string): void {
    this.searchTerm.set(term);
    this.search$.next(term);
  }

  protected toggleExpanded(): void {
    this.emit({ expanded: !this.line().expanded });
  }

  protected onName(name: string): void {
    this.emit({ name, edited: true });
  }

  protected onSku(sku: string): void {
    this.emit({ sku, edited: true });
  }

  protected onQuantity(quantity: number | null): void {
    this.emit({ quantity: quantity ?? 1, edited: true });
  }

  protected onUnitCost(unitCost: number | null): void {
    this.emit({ unitCost: unitCost ?? 0, edited: true });
  }

  protected onTrackSerials(trackSerials: boolean): void {
    this.emit({ trackSerials, edited: true });
  }

  protected acceptProduct(product: MatchedProduct | SearchHit): void {
    this.emit({
      resolution: 'linked',
      linkedProduct: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        quantityOnHand: product.quantityOnHand,
        isSerialized: product.isSerialized,
      },
      edited: true,
      expanded: false,
    });
  }

  protected createAsNew(): void {
    this.emit({ resolution: 'new', linkedProduct: null, edited: true, expanded: false });
  }

  protected skip(): void {
    this.emit({ included: false, expanded: false });
  }

  protected restore(): void {
    // A restored line re-enters review resolved the way the scan left it.
    this.emit({ included: true });
  }

  private emit(patch: Partial<ReviewLine>): void {
    this.update.emit({ ...this.line(), ...patch });
  }
}
