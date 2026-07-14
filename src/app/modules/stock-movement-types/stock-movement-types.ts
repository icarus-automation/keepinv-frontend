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
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { StockMovementTypesService } from './services/stock-movement-types.service';
import {
  EFFECT_OPTIONS,
  EffectMeta,
  StockMovementEffect,
  StockMovementType,
  compareMovementTypes,
  effectMeta,
  isSystemType,
  typeIcon,
} from './types/stock-movement-type.types';

/** An effect plus its display metadata, ready for the segmented picker. */
interface EffectChoice extends EffectMeta {
  readonly value: StockMovementEffect;
}

/**
 * Manages the tenant's stock-movement types — the vocabulary the ledger and the
 * record form draw from. Built-in types (Purchase, Sale, ...) appear locked: they
 * can be renamed but their effect is fixed and they can't be archived. Custom types
 * are fully editable. Keyboard-first and inline throughout, mirroring Categories:
 * quick-add at the top, edit and archive in place, no modals.
 */
@Component({
  selector: 'app-stock-movement-types',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule],
  templateUrl: './stock-movement-types.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class StockMovementTypes {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(StockMovementTypesService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly addInput = viewChild<ElementRef<HTMLInputElement>>('addInput');
  private readonly editNameInput = viewChild<ElementRef<HTMLInputElement>>('editNameInput');

  protected readonly types = signal<StockMovementType[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);

  protected readonly effectChoices: EffectChoice[] = EFFECT_OPTIONS.map((value) => ({
    value,
    ...effectMeta(value),
  }));

  /** Quick-add: a name and the effect it has on stock. Description is set later via edit. */
  protected readonly addForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    effect: this.formBuilder.nonNullable.control<StockMovementEffect>('INCREASE', [
      Validators.required,
    ]),
  });
  protected readonly creating = signal(false);
  protected readonly addError = signal<string | null>(null);

  protected readonly editingId = signal<string | null>(null);
  protected readonly editForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    description: [''],
    effect: this.formBuilder.nonNullable.control<StockMovementEffect>('INCREASE'),
  });
  protected readonly editError = signal<string | null>(null);
  protected readonly savingEdit = signal(false);
  /** True while editing a built-in type, whose effect is fixed. */
  protected readonly editingSystem = signal(false);

  /** Row currently showing the archive confirmation. */
  protected readonly archivingId = signal<string | null>(null);
  /** Row with an archive request in flight. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly archiveError = signal<string | null>(null);

  protected readonly count = computed(() => this.types().length);
  protected readonly isEmpty = computed(
    () => !this.loading() && !this.loadError() && this.types().length === 0,
  );

  constructor() {
    // Keyboard-first: focus the add field on load, then move focus into a row the
    // moment edit mode opens so the operator never reaches for the mouse.
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
        next: (items) => this.types.set(items),
        error: () => this.loadError.set(true),
      });
  }

  protected addType(): void {
    const name = this.addForm.controls.name.value.trim();
    const effectValue = this.addForm.controls.effect.value;
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
      .create({ name, effect: effectValue })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.creating.set(false)),
      )
      .subscribe({
        next: (created) => {
          this.types.update((list) => this.sortTypes([...list, created]));
          this.addForm.reset({ name: '', effect: effectValue });
          this.addInput()?.nativeElement.focus();
        },
        error: (error: unknown) => this.addError.set(this.messageFor(error, name)),
      });
  }

  protected startEdit(type: StockMovementType): void {
    this.cancelArchive();
    this.editError.set(null);
    this.editingSystem.set(isSystemType(type));
    this.editForm.setValue({
      name: type.name,
      description: type.description ?? '',
      effect: type.effect,
    });
    if (isSystemType(type)) {
      this.editForm.controls.effect.disable({ emitEvent: false });
    } else {
      this.editForm.controls.effect.enable({ emitEvent: false });
    }
    this.editingId.set(type.id);
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
      .update(id, {
        name,
        description: description || undefined,
        // A built-in type's effect is fixed; never send it so the backend can't reject the save.
        effect: this.editingSystem() ? undefined : this.editForm.controls.effect.value,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.savingEdit.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.types.update((list) =>
            this.sortTypes(list.map((type) => (type.id === id ? updated : type))),
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

  protected confirmArchive(type: StockMovementType): void {
    this.cancelEdit();
    this.archiveError.set(null);
    this.archivingId.set(type.id);
  }

  protected cancelArchive(): void {
    this.archivingId.set(null);
    this.archiveError.set(null);
  }

  protected archive(type: StockMovementType): void {
    if (this.busyId()) {
      return;
    }
    this.busyId.set(type.id);
    this.archiveError.set(null);
    this.service
      .archive(type.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busyId.set(null)),
      )
      .subscribe({
        next: () => {
          this.types.update((list) => list.filter((item) => item.id !== type.id));
          this.archivingId.set(null);
        },
        error: (error: unknown) => this.archiveError.set(this.messageFor(error, type.name)),
      });
  }

  protected meta(effectValue: StockMovementEffect): EffectMeta {
    return effectMeta(effectValue);
  }

  /** The glyph for a type's leading chip: distinct for built-in types, effect arrow otherwise. */
  protected iconFor(type: StockMovementType): string {
    return typeIcon(type);
  }

  /** Tailwind tint/text classes for a type's leading icon chip, keyed off its direction. */
  protected directionClasses(effectValue: StockMovementEffect): string {
    switch (effectMeta(effectValue).direction) {
      case 'in':
        return 'bg-success/10 text-success';
      case 'out':
        return 'bg-danger/10 text-danger';
      default:
        return 'bg-info/10 text-info';
    }
  }

  protected isSystem(type: StockMovementType): boolean {
    return isSystemType(type);
  }

  protected isEditing(type: StockMovementType): boolean {
    return this.editingId() === type.id;
  }

  protected isArchiving(type: StockMovementType): boolean {
    return this.archivingId() === type.id;
  }

  protected onEscape(): void {
    this.cancelEdit();
    this.cancelArchive();
  }

  private nameTaken(name: string, exceptId?: string): boolean {
    const target = name.toLowerCase();
    return this.types().some(
      (type) => type.id !== exceptId && type.name.toLowerCase() === target,
    );
  }

  private sortTypes(list: StockMovementType[]): StockMovementType[] {
    return [...list].sort(compareMovementTypes);
  }

  private messageFor(error: unknown, name: string): string {
    return httpErrorMessage(error, `"${name}"`);
  }
}
