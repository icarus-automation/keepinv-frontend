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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';

import { OrganizationService } from '../organization/services/organization.service';
import { orgMonogram } from '../organization/organization.util';
import { httpErrorMessage } from '../../../common/http/http-error-message';
import { ImageCropDialog } from '../products/detail/image-crop-dialog';

/** Image types and size ceiling the logo upload accepts; mirrors the backend's validation. */
const ORG_LOGO_ACCEPT = 'image/jpeg,image/png,image/webp';
const ORG_LOGO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The organization's logo and its controls, for owners/admins on the Settings page. Every upload
 * passes through the shared square-crop dialog so the logo stays 1:1 in the sidebar and sign-in
 * screen. Reads/writes go through OrganizationService, whose `organization` signal is already the
 * shared source of truth the rest of the app reacts to — no local caching needed here.
 */
@Component({
  selector: 'app-organization-logo',
  imports: [ButtonModule, ImageCropDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-4">
      <div
        class="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-white"
      >
        @if (logo(); as url) {
          <img [src]="url" [alt]="orgName() + ' logo'" class="h-full w-full object-contain" />
        } @else {
          <span
            class="grid h-full w-full place-items-center bg-ink text-sm font-semibold text-counter"
            aria-hidden="true"
          >
            {{ monogram() }}
          </span>
        }
        @if (busy()) {
          <div class="absolute inset-0 grid place-items-center bg-white/70">
            <i class="pi pi-spin pi-spinner text-base text-muted" aria-hidden="true"></i>
          </div>
        }
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5">
          <p-button
            type="button"
            [icon]="logo() ? 'pi pi-sync' : 'pi pi-upload'"
            [label]="logo() ? 'Replace' : 'Upload logo'"
            [outlined]="true"
            size="small"
            [disabled]="busy()"
            (onClick)="pick()"
            styleClass="font-medium"
          />
          @if (logo()) {
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
      header="Crop your logo"
      description="Your logo is square. Drag to reposition and resize the selection — everything outside it is trimmed."
      (cropped)="onCropped($event)"
      (cancelled)="pendingFile.set(null)"
    />
  `,
})
export class OrganizationLogo {
  private readonly organizationService = inject(OrganizationService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly accept = ORG_LOGO_ACCEPT;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** A picked file awaiting its mandatory square crop; non-null opens the crop dialog. */
  protected readonly pendingFile = signal<File | null>(null);

  protected readonly organization = this.organizationService.organization;
  protected readonly logo = computed(() => this.organization()?.logo?.trim() || null);
  protected readonly orgName = computed(() => this.organization()?.name ?? '');
  protected readonly monogram = computed(() => orgMonogram(this.organization()?.name));

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
    if (!ORG_LOGO_ACCEPT.split(',').includes(file.type)) {
      this.error.set('Use a JPG, PNG or WEBP image.');
      return;
    }
    if (file.size > ORG_LOGO_MAX_BYTES) {
      this.error.set('Image must be 5 MB or smaller.');
      return;
    }
    // Uploads are always square: the crop dialog takes over from here.
    this.pendingFile.set(file);
  }

  protected onCropped(file: File): void {
    this.pendingFile.set(null);
    if (file.size > ORG_LOGO_MAX_BYTES) {
      this.error.set('Cropped image is over 5 MB. Use a smaller photo.');
      return;
    }
    this.upload(file);
  }

  private upload(file: File): void {
    this.busy.set(true);
    this.error.set(null);
    this.organizationService
      .uploadLogo(file)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        error: (error: unknown) => this.error.set(httpErrorMessage(error)),
      });
  }

  protected remove(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.organizationService
      .removeLogo()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        error: (error: unknown) => this.error.set(httpErrorMessage(error)),
      });
  }
}
