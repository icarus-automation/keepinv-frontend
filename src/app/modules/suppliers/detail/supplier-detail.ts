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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';

import { SuppliersService } from '../services/suppliers.service';
import { httpErrorMessage } from '../../../../common/http/http-error-message';
import {
  SUPPLIER_PLATFORMS,
  PlatformOption,
  Supplier,
  SupplierLink,
  SupplierPlatform,
  detectSupplierPlatform,
  platformMeta,
} from '../types/supplier.types';

const HTTP_URL = /^https?:\/\/.+/i;

/**
 * Detail pane for a single supplier: contact info, inline edit/archive, and the
 * reorder channels (Messenger, WhatsApp, Email, ...) the operator taps to buy
 * back. Owns its links state; reports supplier mutations up to the directory.
 */
@Component({
  selector: 'app-supplier-detail',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, TextareaModule, SelectModule],
  templateUrl: './supplier-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class SupplierDetail {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(SuppliersService);
  private readonly destroyRef = inject(DestroyRef);

  readonly supplier = input.required<Supplier>();
  readonly updated = output<Supplier>();
  readonly archived = output<string>();

  protected readonly platforms: PlatformOption[] = [...SUPPLIER_PLATFORMS];
  protected readonly meta = platformMeta;

  private readonly editNameInput = viewChild<ElementRef<HTMLInputElement>>('editNameInput');
  private readonly linkUrlInput = viewChild<ElementRef<HTMLInputElement>>('linkUrlInput');

  /** Links currently shown, kept in sync with the API for the selected supplier. */
  protected readonly links = signal<SupplierLink[]>([]);
  protected readonly linksLoading = signal(true);
  protected readonly linksError = signal(false);
  /** Tracks which supplier's links are loaded so a mere object update doesn't refetch. */
  private loadedId: string | null = null;

  protected readonly editing = signal(false);
  protected readonly savingEdit = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly editForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    contactName: ['', [Validators.maxLength(100)]],
    email: ['', [Validators.email, Validators.maxLength(255)]],
    phone: ['', [Validators.maxLength(50)]],
    address: ['', [Validators.maxLength(255)]],
    notes: ['', [Validators.maxLength(1000)]],
  });

  protected readonly archiving = signal(false);
  protected readonly archiveBusy = signal(false);
  protected readonly archiveError = signal<string | null>(null);

  protected readonly addingLink = signal(false);
  protected readonly addLinkError = signal<string | null>(null);
  /** Once the operator picks a platform by hand, stop auto-detecting it from the URL. */
  protected readonly platformPinned = signal(false);
  protected readonly addLinkForm = this.formBuilder.nonNullable.group({
    platform: this.formBuilder.control<SupplierPlatform | ''>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    url: ['', [Validators.required, Validators.pattern(HTTP_URL), Validators.maxLength(2048)]],
    label: ['', [Validators.maxLength(100)]],
  });

  protected readonly editingLinkId = signal<string | null>(null);
  protected readonly savingLink = signal(false);
  protected readonly linkEditError = signal<string | null>(null);
  protected readonly editLinkForm = this.formBuilder.nonNullable.group({
    platform: this.formBuilder.control<SupplierPlatform | ''>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    url: ['', [Validators.required, Validators.pattern(HTTP_URL), Validators.maxLength(2048)]],
    label: ['', [Validators.maxLength(100)]],
  });

  protected readonly archivingLinkId = signal<string | null>(null);
  protected readonly linkBusyId = signal<string | null>(null);
  protected readonly linkArchiveError = signal<string | null>(null);

  protected readonly hasContact = computed(() => {
    const supplier = this.supplier();
    return !!(supplier.contactName || supplier.email || supplier.phone || supplier.address);
  });
  protected readonly linkCount = computed(() => this.links().length);
  protected readonly linksEmpty = computed(
    () => !this.linksLoading() && !this.linksError() && this.links().length === 0,
  );

  constructor() {
    // Switching the selected supplier resets every transient pane state and
    // reloads its channels. Re-selecting the same record (e.g. after an edit)
    // does not refetch.
    effect(() => {
      const id = this.supplier().id;
      if (id === this.loadedId) {
        return;
      }
      this.loadedId = id;
      this.resetState();
      this.loadLinks(id);
    });

    // Keyboard-first: focus the name field the instant edit mode opens.
    effect(() => {
      if (this.editing()) {
        this.editNameInput()?.nativeElement.focus();
      }
    });

    // Auto-pick the channel platform from the pasted link so the operator rarely sets it
    // by hand. Writes silently (emitEvent:false) so this never counts as a manual choice;
    // the moment they pick a platform themselves it pins and auto-detection stops.
    this.addLinkForm.controls.url.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((url) => {
        if (this.platformPinned()) {
          return;
        }
        this.addLinkForm.controls.platform.setValue(detectSupplierPlatform(url ?? '') ?? '', {
          emitEvent: false,
        });
      });
    this.addLinkForm.controls.platform.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.platformPinned.set(true));
  }

  protected loadLinks(supplierId: string): void {
    this.linksLoading.set(true);
    this.linksError.set(false);
    this.service
      .listLinks(supplierId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.linksLoading.set(false)),
      )
      .subscribe({
        next: (links) => this.links.set(links),
        error: () => this.linksError.set(true),
      });
  }

  protected reloadLinks(): void {
    this.loadLinks(this.supplier().id);
  }

  protected startEdit(): void {
    const supplier = this.supplier();
    this.cancelArchive();
    this.editError.set(null);
    this.editForm.setValue({
      name: supplier.name,
      contactName: supplier.contactName ?? '',
      email: supplier.email ?? '',
      phone: supplier.phone ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
    });
    this.editing.set(true);
  }

  protected saveEdit(): void {
    if (this.savingEdit()) {
      return;
    }
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    const raw = this.editForm.getRawValue();
    const name = raw.name.trim();
    if (!name) {
      this.editForm.controls.name.markAsTouched();
      return;
    }

    this.savingEdit.set(true);
    this.editError.set(null);
    this.service
      .update(this.supplier().id, {
        name,
        contactName: this.optional(raw.contactName),
        email: this.optional(raw.email),
        phone: this.optional(raw.phone),
        address: this.optional(raw.address),
        notes: this.optional(raw.notes),
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.savingEdit.set(false)),
      )
      .subscribe({
        next: (supplier) => {
          this.loadedId = supplier.id;
          this.editing.set(false);
          this.updated.emit(supplier);
        },
        error: (error: unknown) => this.editError.set(httpErrorMessage(error)),
      });
  }

  protected cancelEdit(): void {
    this.editing.set(false);
    this.editError.set(null);
  }

  protected confirmArchive(): void {
    this.cancelEdit();
    this.archiveError.set(null);
    this.archiving.set(true);
  }

  protected cancelArchive(): void {
    this.archiving.set(false);
    this.archiveError.set(null);
  }

  protected archive(): void {
    if (this.archiveBusy()) {
      return;
    }
    const id = this.supplier().id;
    this.archiveBusy.set(true);
    this.archiveError.set(null);
    this.service
      .archive(id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.archiveBusy.set(false)),
      )
      .subscribe({
        next: () => {
          this.archiving.set(false);
          this.archived.emit(id);
        },
        error: (error: unknown) => this.archiveError.set(httpErrorMessage(error)),
      });
  }

  protected addLink(): void {
    if (this.addingLink()) {
      return;
    }
    if (this.addLinkForm.invalid) {
      this.addLinkForm.markAllAsTouched();
      this.addLinkError.set(this.linkValidationMessage(this.addLinkForm.getRawValue()));
      return;
    }

    const raw = this.addLinkForm.getRawValue();
    if (!raw.platform) {
      return;
    }
    this.addingLink.set(true);
    this.addLinkError.set(null);
    this.service
      .createLink(this.supplier().id, {
        platform: raw.platform,
        url: raw.url.trim(),
        label: this.optional(raw.label),
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.addingLink.set(false)),
      )
      .subscribe({
        next: (link) => {
          this.links.update((list) => [...list, link]);
          this.addLinkForm.reset({ platform: '', url: '', label: '' }, { emitEvent: false });
          this.platformPinned.set(false);
        },
        error: (error: unknown) => this.addLinkError.set(httpErrorMessage(error)),
      });
  }

  protected startEditLink(link: SupplierLink): void {
    this.cancelArchiveLink();
    this.linkEditError.set(null);
    this.editLinkForm.setValue({
      platform: link.platform,
      url: link.url,
      label: link.label ?? '',
    });
    this.editingLinkId.set(link.id);
  }

  protected saveLink(): void {
    const id = this.editingLinkId();
    if (!id || this.savingLink()) {
      return;
    }
    if (this.editLinkForm.invalid) {
      this.editLinkForm.markAllAsTouched();
      this.linkEditError.set(this.linkValidationMessage(this.editLinkForm.getRawValue()));
      return;
    }

    const raw = this.editLinkForm.getRawValue();
    if (!raw.platform) {
      return;
    }
    this.savingLink.set(true);
    this.linkEditError.set(null);
    this.service
      .updateLink(this.supplier().id, id, {
        platform: raw.platform,
        url: raw.url.trim(),
        label: this.optional(raw.label),
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.savingLink.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.links.update((list) => list.map((link) => (link.id === id ? updated : link)));
          this.editingLinkId.set(null);
        },
        error: (error: unknown) => this.linkEditError.set(httpErrorMessage(error)),
      });
  }

  protected cancelEditLink(): void {
    this.editingLinkId.set(null);
    this.linkEditError.set(null);
  }

  protected confirmArchiveLink(link: SupplierLink): void {
    this.cancelEditLink();
    this.linkArchiveError.set(null);
    this.archivingLinkId.set(link.id);
  }

  protected cancelArchiveLink(): void {
    this.archivingLinkId.set(null);
    this.linkArchiveError.set(null);
  }

  protected archiveLink(link: SupplierLink): void {
    if (this.linkBusyId()) {
      return;
    }
    this.linkBusyId.set(link.id);
    this.linkArchiveError.set(null);
    this.service
      .archiveLink(this.supplier().id, link.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.linkBusyId.set(null)),
      )
      .subscribe({
        next: () => {
          this.links.update((list) => list.filter((item) => item.id !== link.id));
          this.archivingLinkId.set(null);
        },
        error: (error: unknown) => this.linkArchiveError.set(httpErrorMessage(error)),
      });
  }

  protected isEditingLink(link: SupplierLink): boolean {
    return this.editingLinkId() === link.id;
  }

  protected isArchivingLink(link: SupplierLink): boolean {
    return this.archivingLinkId() === link.id;
  }

  protected onEscape(): void {
    this.cancelEdit();
    this.cancelArchive();
    this.cancelEditLink();
    this.cancelArchiveLink();
  }

  private resetState(): void {
    this.editing.set(false);
    this.editError.set(null);
    this.archiving.set(false);
    this.archiveError.set(null);
    this.editingLinkId.set(null);
    this.linkEditError.set(null);
    this.archivingLinkId.set(null);
    this.linkArchiveError.set(null);
    this.addLinkError.set(null);
    this.addLinkForm.reset({ platform: '', url: '', label: '' }, { emitEvent: false });
    this.platformPinned.set(false);
  }

  private optional(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private linkValidationMessage(value: { platform: string; url: string }): string {
    if (!value.platform) {
      return 'Choose a platform for this channel.';
    }
    if (!HTTP_URL.test(value.url.trim())) {
      return 'Enter a full link starting with http:// or https://';
    }
    return 'Check the channel details and try again.';
  }
}
