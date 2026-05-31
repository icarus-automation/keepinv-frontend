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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { CategoriesService } from './services/categories.service';
import { Category } from './types/category.types';

@Component({
  selector: 'app-categories',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule],
  templateUrl: './categories.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
})

export class Categories {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(CategoriesService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly addInput = viewChild<ElementRef<HTMLInputElement>>('addInput');
  private readonly editNameInput = viewChild<ElementRef<HTMLInputElement>>('editNameInput');

  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);

  /** Quick-add: name only. Description is set later via edit. */
  protected readonly addForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
  });
  protected readonly creating = signal(false);
  protected readonly addError = signal<string | null>(null);

  protected readonly editingId = signal<string | null>(null);
  protected readonly editForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    description: [''],
  });
  protected readonly editError = signal<string | null>(null);
  protected readonly savingEdit = signal(false);

  /** Row currently showing the archive confirmation. */
  protected readonly archivingId = signal<string | null>(null);
  /** Row with an archive request in flight. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly archiveError = signal<string | null>(null);

  protected readonly count = computed(() => this.categories().length);
  protected readonly isEmpty = computed(
    () => !this.loading() && !this.loadError() && this.categories().length === 0,
  );

  constructor() {
    // Keyboard-first: focus the add field on load, then move focus into a row
    // the moment edit mode opens so the operator never reaches for the mouse.
    effect(() => {
      const input = this.editingId() ? this.editNameInput() : this.addInput();
      input?.nativeElement.focus();
    });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.service
      .list()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (items) => this.categories.set(items),
        error: () => this.loadError.set(true),
      });
  }

  protected addCategory(): void {
    const name = this.addForm.controls.name.value.trim();
    this.addError.set(null);

    if (!name) {
      this.addForm.controls.name.markAsTouched();
      return;
    }
    if (this.creating()) {
      return;
    }
    if (this.nameTaken(name)) {
      this.addError.set(`"${name}" already exists.`);
      return;
    }

    this.creating.set(true);
    this.service
      .create({ name })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.creating.set(false)),
      )
      .subscribe({
        next: (created) => {
          this.categories.update((list) => [...list, created]);
          this.addForm.reset({ name: '' });
          this.addInput()?.nativeElement.focus();
        },
        error: (error: unknown) => this.addError.set(this.messageFor(error, name)),
      });
  }

  protected startEdit(category: Category): void {
    this.cancelArchive();
    this.editError.set(null);
    this.editForm.setValue({ name: category.name, description: category.description ?? '' });
    this.editingId.set(category.id);
  }

  protected saveEdit(): void {
    const id = this.editingId();
    if (!id || this.savingEdit()) {
      return;
    }

    const name = this.editForm.controls.name.value.trim();
    const description = this.editForm.controls.description.value.trim();
    this.editError.set(null);

    if (!name) {
      this.editForm.controls.name.markAsTouched();
      return;
    }
    if (this.nameTaken(name, id)) {
      this.editError.set(`"${name}" already exists.`);
      return;
    }

    this.savingEdit.set(true);
    this.service
      .update(id, { name, description: description || undefined })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.savingEdit.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.categories.update((list) =>
            list.map((category) => (category.id === id ? updated : category)),
          );
          this.editingId.set(null);
        },
        error: (error: unknown) => this.editError.set(this.messageFor(error, name)),
      });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editError.set(null);
  }

  protected confirmArchive(category: Category): void {
    this.cancelEdit();
    this.archiveError.set(null);
    this.archivingId.set(category.id);
  }

  protected cancelArchive(): void {
    this.archivingId.set(null);
    this.archiveError.set(null);
  }

  protected archive(category: Category): void {
    if (this.busyId()) {
      return;
    }
    this.busyId.set(category.id);
    this.archiveError.set(null);
    this.service
      .archive(category.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busyId.set(null)),
      )
      .subscribe({
        next: () => {
          this.categories.update((list) => list.filter((item) => item.id !== category.id));
          this.archivingId.set(null);
        },
        error: (error: unknown) => this.archiveError.set(this.messageFor(error, category.name)),
      });
  }

  protected isEditing(category: Category): boolean {
    return this.editingId() === category.id;
  }

  protected isArchiving(category: Category): boolean {
    return this.archivingId() === category.id;
  }

  protected onEscape(): void {
    this.cancelEdit();
    this.cancelArchive();
  }

  private nameTaken(name: string, exceptId?: string): boolean {
    const target = name.toLowerCase();
    return this.categories().some(
      (category) => category.id !== exceptId && category.name.toLowerCase() === target,
    );
  }

  private messageFor(error: unknown, name: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 409) {
        return `"${name}" already exists.`;
      }
      if (error.status === 0) {
        return 'Cannot reach the server. Check your connection and try again.';
      }
    }
    return 'Something went wrong. Try again.';
  }
}
