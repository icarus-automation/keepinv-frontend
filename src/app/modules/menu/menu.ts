import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { MoneyPipe } from '../products/utils/money.pipe';
import { MenuService } from './services/menu.service';
import { MenuFlavor, MenuGroup } from './types/menu.types';

/**
 * The owner's menu editor: the flavors behind the size/flavor POS. Flavors are not products —
 * they hold no stock and have no SKU — so adding one is a single row here rather than a new item
 * per size. The two edits that actually happen daily are one tap each: mark a flavor sold out
 * when the powder runs out, and bring it back when it's restocked.
 *
 * Sizes are shown read-only: they carry the price, the recipe and the cup stock, so they're
 * created and attached on the Menu Items screen instead.
 */
@Component({
  selector: 'app-menu',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, MoneyPipe],
  templateUrl: './menu.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Menu {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(MenuService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly groups = signal<MenuGroup[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  /** Quick-add a flavor to one group. Only the open group's form is rendered. */
  protected readonly addingToGroupId = signal<string | null>(null);
  protected readonly flavorForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    priceDelta: [0],
  });
  protected readonly savingFlavor = signal(false);

  /** New group (rare: a whole new drink line). */
  protected readonly showGroupForm = signal(false);
  protected readonly groupForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    description: [''],
  });
  protected readonly savingGroup = signal(false);

  /** The flavor whose sold-out toggle or archive is in flight, so only that row spins. */
  protected readonly busyFlavorId = signal<string | null>(null);
  /** The flavor showing its archive confirmation. */
  protected readonly archivingFlavorId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly isEmpty = computed(
    () => !this.loading() && !this.loadError() && this.groups().length === 0,
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.service
      .listGroups()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (groups) => this.groups.set(groups),
        error: (error: unknown) => this.loadError.set(httpErrorMessage(error)),
      });
  }

  // --- Groups ---

  protected toggleGroupForm(): void {
    this.showGroupForm.update((open) => !open);
    this.groupForm.reset({ name: '', description: '' });
    this.actionError.set(null);
  }

  protected createGroup(): void {
    const name = this.groupForm.controls.name.value.trim();
    if (!name || this.savingGroup()) {
      this.groupForm.controls.name.markAsTouched();
      return;
    }

    this.savingGroup.set(true);
    this.actionError.set(null);
    this.service
      .createGroup({ name, description: this.groupForm.controls.description.value.trim() || undefined })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.savingGroup.set(false)),
      )
      .subscribe({
        next: (group) => {
          this.groups.update((current) => [...current, group]);
          this.showGroupForm.set(false);
          this.groupForm.reset({ name: '', description: '' });
        },
        error: (error: unknown) => this.actionError.set(httpErrorMessage(error)),
      });
  }

  // --- Flavors ---

  protected openFlavorForm(groupId: string): void {
    this.addingToGroupId.set(groupId);
    this.flavorForm.reset({ name: '', priceDelta: 0 });
    this.actionError.set(null);
  }

  protected closeFlavorForm(): void {
    this.addingToGroupId.set(null);
    this.actionError.set(null);
  }

  protected addFlavor(groupId: string): void {
    const name = this.flavorForm.controls.name.value.trim();
    if (!name || this.savingFlavor()) {
      this.flavorForm.controls.name.markAsTouched();
      return;
    }

    this.savingFlavor.set(true);
    this.actionError.set(null);
    this.service
      .createFlavor(groupId, {
        name,
        priceDelta: Number(this.flavorForm.controls.priceDelta.value) || 0,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.savingFlavor.set(false)),
      )
      .subscribe({
        next: (flavor) => {
          this.replaceFlavor(groupId, flavor);
          this.flavorForm.reset({ name: '', priceDelta: 0 });
        },
        error: (error: unknown) => this.actionError.set(httpErrorMessage(error)),
      });
  }

  /** The daily edit: pull a flavor when the powder runs out, restore it when it's back. */
  protected toggleAvailability(group: MenuGroup, flavor: MenuFlavor): void {
    if (this.busyFlavorId()) {
      return;
    }
    this.busyFlavorId.set(flavor.id);
    this.actionError.set(null);
    this.service
      .updateFlavor(flavor.id, { isAvailable: !flavor.isAvailable })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busyFlavorId.set(null)),
      )
      .subscribe({
        next: (updated) => this.replaceFlavor(group.id, updated),
        error: (error: unknown) => this.actionError.set(httpErrorMessage(error)),
      });
  }

  protected confirmArchive(flavorId: string): void {
    this.archivingFlavorId.set(flavorId);
    this.actionError.set(null);
  }

  protected cancelArchive(): void {
    this.archivingFlavorId.set(null);
  }

  protected archiveFlavor(group: MenuGroup, flavor: MenuFlavor): void {
    if (this.busyFlavorId()) {
      return;
    }
    this.busyFlavorId.set(flavor.id);
    this.actionError.set(null);
    this.service
      .archiveFlavor(flavor.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busyFlavorId.set(null)),
      )
      .subscribe({
        next: () => {
          this.archivingFlavorId.set(null);
          this.groups.update((groups) =>
            groups.map((row) =>
              row.id === group.id
                ? { ...row, flavors: row.flavors.filter((item) => item.id !== flavor.id) }
                : row,
            ),
          );
        },
        error: (error: unknown) => {
          this.archivingFlavorId.set(null);
          this.actionError.set(httpErrorMessage(error));
        },
      });
  }

  /** Insert or replace a flavor inside its group, keeping the server's ordering. */
  private replaceFlavor(groupId: string, flavor: MenuFlavor): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        const exists = group.flavors.some((item) => item.id === flavor.id);
        const flavors = exists
          ? group.flavors.map((item) => (item.id === flavor.id ? flavor : item))
          : [...group.flavors, flavor];
        return { ...group, flavors };
      }),
    );
  }

  /**
   * Whether this flavor charges over the base size. Compared numerically, not against "0.00":
   * the admin endpoint returns raw decimals ("0", "10"), unlike the POS menu's formatted strings.
   */
  protected hasSurcharge(flavor: MenuFlavor): boolean {
    return Number(flavor.priceDelta) > 0;
  }

  /** A size's button label, falling back to the product name when no label was set. */
  protected sizeLabel(size: MenuGroup['products'][number]): string {
    return size.menuSizeLabel?.trim() || size.name;
  }

  protected soldOutCount(group: MenuGroup): number {
    return group.flavors.filter((flavor) => !flavor.isAvailable).length;
  }
}
