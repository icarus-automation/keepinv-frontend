import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';

import { ProductsService } from '../services/products.service';
import {
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_PLACEHOLDER,
  Product,
} from '../types/product.types';
import { httpErrorMessage } from '../../../../common/http/http-error-message';
import { ImageCropDialog } from './image-crop-dialog';

/**
 * The product photo and its controls in the detail pane. Shows the Cloudinary image (or a
 * placeholder when none), and lets any plan upload, replace, or remove it. Every upload passes
 * through a mandatory square crop so the whole catalog stays 1:1. The backend returns the
 * hydrated product after each change, which we hand up so the catalog and detail stay in sync.
 */
@Component({
  selector: 'app-product-image',
  imports: [ButtonModule, ImageCropDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-start gap-4">
      <div
        class="relative grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white"
      >
        <img
          [src]="imageSrc()"
          [alt]="showsPhoto() ? product().name + ' photo' : 'No product photo'"
          class="h-full w-full object-contain"
          [class.opacity-60]="!showsPhoto()"
          decoding="async"
          (error)="onImageError()"
        />
        @if (busy()) {
          <div class="absolute inset-0 grid place-items-center bg-white/70">
            <i class="pi pi-spin pi-spinner text-xl text-muted" aria-hidden="true"></i>
          </div>
        }
      </div>

      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">Photo</p>
        <p class="mt-0.5 text-sm text-muted">
          {{ hasImage() ? 'Shown on the detail pane and barcode sheet.' : 'No photo uploaded yet.' }}
        </p>

        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <p-button
            type="button"
            [icon]="hasImage() ? 'pi pi-sync' : 'pi pi-upload'"
            [label]="hasImage() ? 'Replace' : 'Upload photo'"
            [outlined]="true"
            size="small"
            [disabled]="busy()"
            (onClick)="pick()"
            styleClass="font-medium"
          />
          @if (hasImage()) {
            <p-button
              type="button"
              icon="pi pi-trash"
              label="Remove"
              [text]="true"
              severity="danger"
              size="small"
              [disabled]="busy()"
              (onClick)="remove()"
              styleClass="font-medium"
            />
          }
        </div>

        @if (error()) {
          <p role="alert" class="mt-1.5 text-xs text-danger">{{ error() }}</p>
        }
        <p class="mt-1.5 text-xs text-muted">JPG, PNG or WEBP · up to 5 MB.</p>
      </div>
    </div>

    <input
      #fileInput
      type="file"
      [accept]="accept"
      class="hidden"
      (change)="onFileSelected($event)"
    />

    <app-image-crop-dialog
      [file]="pendingFile()"
      (cropped)="onCropped($event)"
      (cancelled)="pendingFile.set(null)"
    />
  `,
})
export class ProductImage {
  private readonly service = inject(ProductsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly product = input.required<Product>();
  readonly changed = output<Product>();

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly accept = PRODUCT_IMAGE_ACCEPT;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** A picked file awaiting its mandatory square crop; non-null opens the crop dialog. */
  protected readonly pendingFile = signal<File | null>(null);
  /** Set when the hosted image 404s (e.g. Cloudinary bg-removal add-on not enabled); shows placeholder. */
  private readonly broken = signal(false);

  /** A photo URL exists on the product (drives Replace/Remove), even if it failed to load. */
  protected readonly hasImage = computed(() => !!this.product().imageUrl);
  /** A photo is actually being shown (URL present and it loaded). */
  protected readonly showsPhoto = computed(() => this.hasImage() && !this.broken());
  protected readonly imageSrc = computed(() => {
    const url = this.product().imageUrl;
    return this.showsPhoto() && url ? url : PRODUCT_IMAGE_PLACEHOLDER;
  });

  constructor() {
    // A new product (or a fresh upload) gets a clean slate for the load-error fallback.
    effect(() => {
      this.product();
      this.broken.set(false);
    });
  }

  protected onImageError(): void {
    if (this.hasImage()) {
      this.broken.set(true);
    }
  }

  protected pick(): void {
    this.error.set(null);
    this.fileInput().nativeElement.click();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the value so re-picking the same file still fires `change`.
    input.value = '';
    if (!file) {
      return;
    }
    if (!PRODUCT_IMAGE_ACCEPT.split(',').includes(file.type)) {
      this.error.set('Use a JPG, PNG or WEBP image.');
      return;
    }
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      this.error.set('Image must be 5 MB or smaller.');
      return;
    }
    // Uploads are always square: the crop dialog takes over from here.
    this.pendingFile.set(file);
  }

  protected onCropped(file: File): void {
    this.pendingFile.set(null);
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      this.error.set('Cropped image is over 5 MB. Use a smaller photo.');
      return;
    }
    this.upload(file);
  }

  private upload(file: File): void {
    this.busy.set(true);
    this.error.set(null);
    this.service
      .uploadImage(this.product().id, file)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: (product) => this.changed.emit(product),
        error: (error: unknown) => this.error.set(httpErrorMessage(error)),
      });
  }

  protected remove(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.service
      .removeImage(this.product().id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: (product) => this.changed.emit(product),
        error: (error: unknown) => this.error.set(httpErrorMessage(error)),
      });
  }
}
