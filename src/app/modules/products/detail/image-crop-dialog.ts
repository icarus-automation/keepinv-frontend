import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { ImageCropperComponent, ImageCroppedEvent } from 'ngx-image-cropper';

/**
 * Mandatory square crop before an image uploads (product photos, org logo). Header/description
 * text is overridable per caller; the 1:1 aspect ratio itself is not. Opens whenever `file` is
 * set; resolves via `cropped` (a ready-to-upload square file) or `cancelled`.
 */
@Component({
  selector: 'app-image-crop-dialog',
  imports: [DialogModule, ButtonModule, ImageCropperComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [visible]="file() !== null"
      (visibleChange)="!$event && cancel()"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [closable]="true"
      [header]="header()"
      [style]="{ width: 'min(30rem, calc(100vw - 2rem))' }"
    >
      <p class="text-sm text-muted">{{ description() }}</p>

      <div class="mt-3 flex h-[60vh] items-center justify-center overflow-hidden rounded-md border border-line bg-panel">
        @if (file(); as pending) {
          <image-cropper
            [imageFile]="pending"
            [maintainAspectRatio]="true"
            [aspectRatio]="1"
            [format]="format()"
            output="blob"
            (imageCropped)="onCropped($event)"
            (imageLoaded)="loadFailed.set(false)"
            (loadImageFailed)="loadFailed.set(true)"
          />
        }
      </div>

      @if (loadFailed()) {
        <p role="alert" class="mt-2 text-xs text-danger">
          Couldn't open this image. Try a different JPG, PNG, or WEBP file.
        </p>
      }

      <div class="mt-4 flex items-center justify-end gap-2">
        <p-button
          type="button"
          label="Cancel"
          [text]="true"
          severity="secondary"
          (onClick)="cancel()"
          styleClass="font-medium"
        />
        <p-button
          type="button"
          label="Use photo"
          icon="pi pi-check"
          [disabled]="loadFailed() || !hasCrop()"
          (onClick)="confirm()"
          styleClass="font-medium"
        />
      </div>
    </p-dialog>
  `,
})
export class ImageCropDialog {
  /** The freshly picked file to crop; null keeps the dialog closed. */
  readonly file = input<File | null>(null);
  readonly header = input('Crop to square');
  readonly description = input(
    'Product photos are square. Drag to reposition and resize the selection — everything outside it is trimmed.',
  );
  /** The square result, named after the original and ready for upload. */
  readonly cropped = output<File>();
  readonly cancelled = output<void>();

  protected readonly loadFailed = signal(false);
  private readonly croppedBlob = signal<Blob | null>(null);
  protected readonly hasCrop = computed(() => this.croppedBlob() !== null);

  /** PNG stays PNG (transparency, line art); everything else compresses well as JPEG. */
  protected readonly format = computed<'png' | 'jpeg'>(() =>
    this.file()?.type === 'image/png' ? 'png' : 'jpeg',
  );

  protected onCropped(event: ImageCroppedEvent): void {
    this.croppedBlob.set(event.blob ?? null);
  }

  protected confirm(): void {
    const source = this.file();
    const blob = this.croppedBlob();
    if (!source || !blob) {
      return;
    }
    const extension = this.format() === 'png' ? 'png' : 'jpg';
    const baseName = source.name.replace(/\.[^.]+$/, '') || 'product-photo';
    const type = this.format() === 'png' ? 'image/png' : 'image/jpeg';
    this.croppedBlob.set(null);
    this.cropped.emit(new File([blob], `${baseName}.${extension}`, { type }));
  }

  protected cancel(): void {
    this.croppedBlob.set(null);
    this.cancelled.emit();
  }
}
