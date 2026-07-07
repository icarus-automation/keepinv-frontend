import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription, forkJoin, map, of, catchError } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';

import { CategoriesService } from '../categories/services/categories.service';
import { LocationsService } from '../locations/services/locations.service';
import { httpErrorMessage } from '../../../common/http/http-error-message';
import { ReceiptImportsService } from './services/receipt-imports.service';
import {
  RECEIPT_ACCEPT,
  RECEIPT_MAX_BYTES,
  ReceiptImportCommit,
  ReceiptImportItemRequest,
  ReceiptImportRequest,
  ReceiptScanResult,
} from './types/receipt-import.types';
import { ReviewLine, isResolved, toReviewLine } from './review/review-line.model';
import { ReviewLineRow } from './review/review-line';

type Phase = 'capture' | 'scanning' | 'review' | 'done';

/** File extensions accepted alongside MIME sniffing (camera HEICs often carry no MIME type). */
const ACCEPT_EXTENSIONS = /\.(jpe?g|png|bmp|tiff?|heic|heif|pdf)$/i;

/** A record with the minimum a `p-select` option needs. */
interface NamedRecord {
  id: string;
  name: string;
}

/**
 * Scan Receipt: photograph or upload a supplier receipt, review the OCR'd lines against the
 * catalog, then commit — matched products gain stock, new ones are created and stocked, all as
 * PURCHASE movements. One page, four phases: capture → scanning → review → done.
 */
@Component({
  selector: 'app-scan-receipt',
  imports: [
    CurrencyPipe,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    ReviewLineRow,
  ],
  templateUrl: './scan-receipt.html',
  styleUrl: './scan-receipt.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class ScanReceipt {
  private readonly receiptImports = inject(ReceiptImportsService);
  private readonly categories = inject(CategoriesService);
  private readonly locations = inject(LocationsService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly accept = RECEIPT_ACCEPT;

  protected readonly phase = signal<Phase>('capture');
  protected readonly captureError = signal<string | null>(null);
  protected readonly dragOver = signal(false);

  /** The picked file + a preview URL (object URL for images; PDFs show an icon instead). */
  private file: File | null = null;
  protected readonly fileName = signal<string | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly isPdf = signal(false);

  /** Seconds since the scan started; drives the escalating progress copy. */
  protected readonly scanElapsed = signal(0);
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private scanSub: Subscription | null = null;

  protected readonly scan = signal<ReceiptScanResult | null>(null);
  protected readonly lines = signal<ReviewLine[]>([]);

  protected readonly committing = signal(false);
  protected readonly commitError = signal<string | null>(null);
  protected readonly confirmingCancel = signal(false);
  protected readonly commitResult = signal<ReceiptImportCommit | null>(null);
  /** True when the commit replayed an idempotency key: already recorded, nothing double-stocked. */
  protected readonly duplicate = signal(false);

  protected readonly categoryOptions = signal<NamedRecord[]>([]);
  protected readonly locationOptions = signal<NamedRecord[]>([]);
  protected readonly defaultsOpen = signal(false);

  private readonly reviewHeading = viewChild<ElementRef<HTMLElement>>('reviewHeading');
  private readonly doneHeading = viewChild<ElementRef<HTMLElement>>('doneHeading');
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly cameraInput = viewChild.required<ElementRef<HTMLInputElement>>('cameraInput');

  /** Receipt header + import defaults. Line edits live in the `lines` signal instead. */
  protected readonly form = this.formBuilder.nonNullable.group({
    supplierName: ['', [Validators.required, Validators.maxLength(150)]],
    date: [''],
    categoryId: this.formBuilder.control<string | null>(null),
    locationId: this.formBuilder.control<string | null>(null),
    reorderPoint: this.formBuilder.control<number | null>(null),
    markupPercent: this.formBuilder.control<number | null>(null),
  });

  private readonly formValid = toSignal(
    this.form.statusChanges.pipe(map((status) => status === 'VALID')),
    { initialValue: this.form.valid },
  );

  protected readonly currencyCode = computed(() => this.scan()?.receipt.currency ?? 'PHP');

  protected readonly includedLines = computed(() => this.lines().filter((line) => line.included));
  protected readonly unresolvedCount = computed(
    () => this.lines().filter((line) => !isResolved(line)).length,
  );
  protected readonly stockingCount = computed(
    () =>
      this.includedLines().filter(
        (line) => line.resolution === 'matched' || line.resolution === 'linked',
      ).length,
  );
  protected readonly creatingCount = computed(
    () => this.includedLines().filter((line) => line.resolution === 'new').length,
  );
  protected readonly skippedCount = computed(
    () => this.lines().filter((line) => !line.included).length,
  );
  protected readonly linesTotal = computed(() =>
    this.includedLines().reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
  );
  /** Receipt printed a total and our included lines add up differently: worth a heads-up. */
  protected readonly totalMismatch = computed(() => {
    const printed = this.scan()?.receipt.total;
    if (printed == null) {
      return false;
    }
    return Math.abs(printed - this.linesTotal()) > 0.01;
  });

  protected readonly canCommit = computed(
    () =>
      this.includedLines().length > 0 &&
      this.unresolvedCount() === 0 &&
      this.formValid() &&
      !this.committing(),
  );

  protected readonly commitBlocker = computed<string | null>(() => {
    if (this.committing()) {
      return null;
    }
    if (this.includedLines().length === 0) {
      return 'Nothing to add — every line is skipped.';
    }
    const unresolved = this.unresolvedCount();
    if (unresolved > 0) {
      return unresolved === 1
        ? '1 line still needs review.'
        : `${unresolved} lines still need review.`;
    }
    if (!this.formValid()) {
      return 'Supplier name is required.';
    }
    return null;
  });

  protected readonly progressCopy = computed(() => {
    const elapsed = this.scanElapsed();
    if (elapsed < 8) {
      return 'Reading your receipt…';
    }
    if (elapsed < 30) {
      return 'Still reading — receipts with many lines take a little longer.';
    }
    return 'Almost there. Large scans can take up to 90 seconds.';
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.stopScanTimer();
      this.scanSub?.unsubscribe();
      this.releasePreview();
    });
  }

  // ---- Capture ----

  protected pickFile(): void {
    this.fileInput().nativeElement.click();
  }

  protected pickCamera(): void {
    this.cameraInput().nativeElement.click();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      this.startScan(file);
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(): void {
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.startScan(file);
    }
  }

  private validate(file: File): string | null {
    const typeOk = RECEIPT_ACCEPT.split(',').includes(file.type);
    const extensionOk = ACCEPT_EXTENSIONS.test(file.name);
    if (!typeOk && !extensionOk) {
      if (file.type === 'image/webp') {
        return 'WEBP isn’t supported by the scanner. Use a JPG, PNG, or PDF instead.';
      }
      return 'Use a JPG, PNG, BMP, TIFF, HEIC photo or a PDF.';
    }
    if (file.size > RECEIPT_MAX_BYTES) {
      return 'File must be 10 MB or smaller.';
    }
    return null;
  }

  // ---- Scanning ----

  private startScan(file: File): void {
    const problem = this.validate(file);
    if (problem) {
      this.captureError.set(problem);
      return;
    }

    this.captureError.set(null);
    this.file = file;
    this.fileName.set(file.name);
    this.releasePreview();
    const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    this.isPdf.set(pdf);
    if (!pdf) {
      this.previewUrl.set(URL.createObjectURL(file));
    }

    this.phase.set('scanning');
    this.scanElapsed.set(0);
    this.stopScanTimer();
    this.scanTimer = setInterval(() => this.scanElapsed.update((value) => value + 1), 1000);

    this.scanSub = this.receiptImports
      .scan(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.stopScanTimer();
          this.enterReview(result);
        },
        error: (error: unknown) => {
          this.stopScanTimer();
          this.phase.set('capture');
          this.captureError.set(this.scanErrorMessage(error));
        },
      });

    this.loadDefaultsOptions();
  }

  protected cancelScan(): void {
    this.scanSub?.unsubscribe();
    this.scanSub = null;
    this.stopScanTimer();
    this.phase.set('capture');
  }

  private scanErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 502 || error.status === 504) {
        return 'The receipt reader timed out. Try again — a sharper, well-lit photo helps.';
      }
      if (error.status === 503) {
        return 'Receipt scanning is not available right now. Try again in a few minutes.';
      }
      if (error.status === 413) {
        return 'File must be 10 MB or smaller.';
      }
    }
    return httpErrorMessage(error);
  }

  // ---- Review ----

  private enterReview(result: ReceiptScanResult): void {
    this.scan.set(result);
    this.lines.set(result.items.map(toReviewLine));
    this.commitError.set(null);
    this.confirmingCancel.set(false);
    this.defaultsOpen.set(false);
    this.form.reset({
      supplierName: result.supplier.matchedSupplier?.name ?? result.receipt.merchantName ?? '',
      date: result.receipt.date ? result.receipt.date.slice(0, 10) : '',
      categoryId: null,
      locationId: null,
      reorderPoint: null,
      markupPercent: null,
    });
    this.phase.set('review');
    setTimeout(() => this.reviewHeading()?.nativeElement.focus());
  }

  private loadDefaultsOptions(): void {
    // Master data for the defaults panel; a failure only costs the selects, never the scan.
    forkJoin([
      this.categories.list().pipe(catchError(() => of([]))),
      this.locations.list().pipe(catchError(() => of([]))),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([categories, locations]) => {
        this.categoryOptions.set(categories.map(({ id, name }) => ({ id, name })));
        this.locationOptions.set(locations.map(({ id, name }) => ({ id, name })));
      });
  }

  protected onLineUpdate(updated: ReviewLine): void {
    this.lines.update((lines) => lines.map((line) => (line.key === updated.key ? updated : line)));
  }

  protected toggleDefaults(): void {
    this.defaultsOpen.update((open) => !open);
  }

  protected requestCancel(): void {
    this.confirmingCancel.set(true);
  }

  protected keepReviewing(): void {
    this.confirmingCancel.set(false);
  }

  protected discardScan(): void {
    this.reset();
  }

  protected onEscape(): void {
    if (this.confirmingCancel()) {
      this.confirmingCancel.set(false);
    }
  }

  // ---- Commit ----

  protected commit(): void {
    const scan = this.scan();
    if (!scan || !this.canCommit()) {
      return;
    }

    this.committing.set(true);
    this.commitError.set(null);

    this.receiptImports
      .commit(this.buildPayload(scan))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.committing.set(false);
          this.commitResult.set(result);
          this.duplicate.set(false);
          this.phase.set('done');
          setTimeout(() => this.doneHeading()?.nativeElement.focus());
        },
        error: (error: unknown) => {
          this.committing.set(false);
          if (error instanceof HttpErrorResponse && error.status === 409) {
            // Idempotency replay: this exact scan was already committed. Nothing double-stocked.
            this.duplicate.set(true);
            this.commitResult.set(null);
            this.phase.set('done');
            setTimeout(() => this.doneHeading()?.nativeElement.focus());
            return;
          }
          this.commitError.set(httpErrorMessage(error));
        },
      });
  }

  private buildPayload(scan: ReceiptScanResult): ReceiptImportRequest {
    const value = this.form.getRawValue();

    const items: ReceiptImportItemRequest[] = this.includedLines().map((line) => {
      const item: ReceiptImportItemRequest = {
        rawName: line.scan.rawName,
        normalizedName: line.name.trim() || line.scan.normalizedName,
        quantity: line.quantity,
        unitCost: line.unitCost,
      };
      if (line.resolution === 'matched' || line.resolution === 'linked') {
        item.productId = line.linkedProduct?.id;
      }
      if (line.resolution === 'new') {
        item.isSerialized = line.trackSerials;
      }
      if (line.sku.trim()) {
        item.sku = line.sku.trim();
      }
      // Untouched lines keep the OCR confidence; any user decision or edit means the line was
      // reviewed, so confidence is omitted and the backend skips its minimum-confidence gate.
      if (!line.edited) {
        item.confidence = line.scan.confidence;
      }
      return item;
    });

    return {
      supplier: { name: value.supplierName.trim() },
      receipt: {
        ...(value.date ? { date: value.date } : {}),
        ...(scan.receipt.currency ? { currency: scan.receipt.currency } : {}),
        ...(scan.receipt.subtotal != null ? { subtotal: scan.receipt.subtotal } : {}),
        ...(scan.receipt.tax != null ? { tax: scan.receipt.tax } : {}),
        ...(scan.receipt.total != null ? { total: scan.receipt.total } : {}),
      },
      defaults: {
        ...(value.categoryId ? { categoryId: value.categoryId } : {}),
        ...(value.locationId ? { locationId: value.locationId } : {}),
        ...(value.reorderPoint != null ? { reorderPoint: value.reorderPoint } : {}),
        ...(value.markupPercent != null ? { sellingPriceMarkupPercent: value.markupPercent } : {}),
      },
      items,
      source: {
        channel: 'web',
        processedBy: 'azure-document-intelligence',
        idempotencyKey: scan.idempotencyKey,
      },
    };
  }

  // ---- Done / reset ----

  protected reset(): void {
    this.scanSub?.unsubscribe();
    this.scanSub = null;
    this.stopScanTimer();
    this.releasePreview();
    this.file = null;
    this.fileName.set(null);
    this.isPdf.set(false);
    this.scan.set(null);
    this.lines.set([]);
    this.commitResult.set(null);
    this.duplicate.set(false);
    this.commitError.set(null);
    this.captureError.set(null);
    this.confirmingCancel.set(false);
    this.phase.set('capture');
  }

  private releasePreview(): void {
    const url = this.previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
      this.previewUrl.set(null);
    }
  }

  private stopScanTimer(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }
}
