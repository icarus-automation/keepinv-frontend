import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { PreferencesService, TextScaleId } from '../../../common/preferences/preferences.service';
import { httpErrorMessage } from '../../../common/http/http-error-message';
import { OrganizationService } from '../organization/services/organization.service';
import { orgMonogram } from '../organization/organization.util';
import { OrganizationLogo } from './organization-logo';

/**
 * Two scopes on one page: the organization (shared across the team, editable by
 * owners and admins) and per-device display preferences (this browser only).
 * Org reads and writes go through {@link OrganizationService}; owners/admins can
 * upload/replace/remove the logo directly via {@link OrganizationLogo}.
 */
@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, OrganizationLogo],
  templateUrl: './settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  private readonly preferences = inject(PreferencesService);
  private readonly organizationService = inject(OrganizationService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly textScaleOptions = this.preferences.textScaleOptions;
  protected readonly textScale = this.preferences.textScale;

  protected readonly organization = this.organizationService.organization;
  protected readonly canManage = this.organizationService.canManage;
  protected readonly orgLogo = computed(() => this.organization()?.logo?.trim() || null);
  protected readonly orgMonogram = computed(() => orgMonogram(this.organization()?.name));

  protected readonly roleLabel = computed(() => {
    switch (this.organizationService.myRole()) {
      case 'owner':
        return 'Owner';
      case 'admin':
        return 'Admin';
      case 'member':
        return 'Member';
      default:
        return null;
    }
  });

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saved = signal(false);

  protected readonly nameForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
  });

  constructor() {
    // Seed the field from the org name once it resolves, but never clobber an
    // edit in progress (pristine guard).
    effect(() => {
      const org = this.organization();
      const control = this.nameForm.controls.name;
      if (org && control.pristine) {
        control.setValue(org.name, { emitEvent: false });
      }
    });

    // Editing again clears the last save outcome so it isn't stale.
    this.nameForm.controls.name.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.saved()) {
        this.saved.set(false);
      }
      if (this.saveError()) {
        this.saveError.set(null);
      }
    });
  }

  protected setTextScale(id: TextScaleId): void {
    this.preferences.setTextScale(id);
  }

  protected nameInvalid(): boolean {
    const control = this.nameForm.controls.name;
    return control.touched && control.invalid;
  }

  protected saveOrgName(): void {
    if (!this.canManage() || this.nameForm.invalid || this.saving()) {
      this.nameForm.markAllAsTouched();
      return;
    }

    const name = this.nameForm.getRawValue().name.trim();
    if (name === this.organization()?.name) {
      this.nameForm.controls.name.markAsPristine();
      this.saved.set(true);
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    this.saved.set(false);

    this.organizationService.updateName(name).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        this.nameForm.controls.name.markAsPristine();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.saveError.set(httpErrorMessage(error));
      },
    });
  }
}
