import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { ProductsService } from '../products/services/products.service';
import { Product } from '../products/types/product.types';
import { MoneyPipe } from '../products/utils/money.pipe';
import { httpErrorMessage } from '../../../common/http/http-error-message';
import { buildCatalogSheet, GeneratedSheet } from './catalog-sheet-pdf';

/** Tiles per A4 page; mirrors the PDF generator's 2x3 grid so the page count matches. */
const TILES_PER_PAGE = 6;

/**
 * Barcode catalog sheet (PRO). Pick products that carry a barcode, then generate an A4 sheet of
 * photo + name + price + barcode tiles to print and tape by the till — so fast-moving, label-less
 * items (nails, screws) can be scanned instead of keyed in by hand. Products without a barcode are
 * shown but disabled, since there would be nothing to scan.
 */
@Component({
  selector: 'app-catalog-sheet',
  imports: [ReactiveFormsModule, TableModule, ButtonModule, InputTextModule, MoneyPipe],
  templateUrl: './catalog-sheet.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogSheet {
  private readonly service = inject(ProductsService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly products = signal<Product[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly rows = 8;
  protected readonly first = signal(0);
  protected readonly searchControl = new FormControl('', { nonNullable: true });

  protected readonly titleControl = new FormControl('Product Barcode Sheet', { nonNullable: true });
  protected readonly subtitleControl = new FormControl('Scan the barcode for the item you want.', {
    nonNullable: true,
  });

  /** Selected products keyed by id, kept across pages so a multi-page pick survives paging. */
  private readonly selection = signal<Map<string, Product>>(new Map());
  protected readonly selectedList = computed(() => [...this.selection().values()]);
  protected readonly selectedCount = computed(() => this.selection().size);
  protected readonly sheetPages = computed(() => Math.ceil(this.selectedCount() / TILES_PER_PAGE));

  protected readonly generating = signal(false);
  protected readonly genError = signal<string | null>(null);
  /** True when the selection changed after the last generate, so the preview is out of date. */
  protected readonly stale = signal(false);

  protected readonly previewUrl = signal<SafeResourceUrl | null>(null);
  private sheet: GeneratedSheet | null = null;

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.first.set(0);
        this.load();
      });

    this.destroyRef.onDestroy(() => this.revokeSheet());
    this.load();
  }

  protected onLazyLoad(event: TableLazyLoadEvent): void {
    const requestedFirst = event.first ?? 0;
    if (requestedFirst === this.first()) {
      return;
    }
    this.first.set(requestedFirst);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.service
      .list({
        page: Math.floor(this.first() / this.rows) + 1,
        limit: this.rows,
        search: this.searchControl.value.trim() || undefined,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ({ items, meta }) => {
          this.products.set(items);
          this.total.set(meta.total);
        },
        error: (error: unknown) => this.loadError.set(httpErrorMessage(error)),
      });
  }

  protected isSelected(id: string): boolean {
    return this.selection().has(id);
  }

  protected toggle(product: Product): void {
    if (!product.barcode) {
      return;
    }
    this.selection.update((current) => {
      const next = new Map(current);
      if (next.has(product.id)) {
        next.delete(product.id);
      } else {
        next.set(product.id, product);
      }
      return next;
    });
    this.markStale();
  }

  protected clearSelection(): void {
    if (!this.selectedCount()) {
      return;
    }
    this.selection.set(new Map());
    this.markStale();
  }

  /** A selection change invalidates any existing preview. */
  private markStale(): void {
    if (this.sheet) {
      this.stale.set(true);
    }
  }

  protected generate(): void {
    const items = this.selectedList();
    if (!items.length || this.generating()) {
      return;
    }
    this.generating.set(true);
    this.genError.set(null);

    buildCatalogSheet(items, {
      title: this.titleControl.value.trim() || 'Product Barcode Sheet',
      subtitle: this.subtitleControl.value.trim() || undefined,
    })
      .then((sheet) => {
        this.revokeSheet();
        this.sheet = sheet;
        this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(sheet.url));
        this.stale.set(false);
      })
      .catch((error: unknown) => this.genError.set(httpErrorMessage(error)))
      .finally(() => this.generating.set(false));
  }

  protected download(): void {
    if (!this.sheet) {
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = this.sheet.url;
    anchor.download = `${this.fileSlug()}.pdf`;
    anchor.click();
  }

  /** Print the generated PDF straight to the OS print dialog via a hidden iframe. */
  protected print(): void {
    if (!this.sheet) {
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = this.sheet.url;
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      // Leave the frame attached long enough for the print dialog to read it, then clean up.
      window.setTimeout(() => iframe.remove(), 60_000);
    };
    document.body.appendChild(iframe);
  }

  private fileSlug(): string {
    const base = this.titleControl.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return base.replace(/^-+|-+$/g, '') || 'barcode-sheet';
  }

  private revokeSheet(): void {
    if (this.sheet) {
      URL.revokeObjectURL(this.sheet.url);
      this.sheet = null;
    }
    this.previewUrl.set(null);
  }
}
