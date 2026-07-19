import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { NgOptimizedImage } from '@angular/common';

import { httpErrorMessage } from '../../../../common/http/http-error-message';
import { AuthService } from '../services/auth.service';
import { OrganizationService } from '../../organization/services/organization.service';
import { EntitlementsService } from '../../../../common/entitlements/entitlements.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, PasswordModule, NgOptimizedImage],
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly organizationService = inject(OrganizationService);
  private readonly entitlements = inject(EntitlementsService);
  private readonly router = inject(Router);

  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  constructor() {
    // Keyboard-first: land focus on the first field so the operator can type or scan immediately.
    afterNextRender(() => this.emailInput()?.nativeElement.focus());
  }

  protected isInvalid(control: 'email' | 'password'): boolean {
    const field = this.form.controls[control];
    return field.touched && field.invalid;
  }

  protected submit(): void {
    if (this.form.invalid || this.loading()) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    // Hydrate the org + plan entitlements before entering the app, so the shell renders branded
    // and feature-gated (RFID, label printing) on first paint rather than after a refresh.
    this.authService
      .login(this.form.getRawValue())
      .pipe(
        switchMap(() =>
          forkJoin([
            this.organizationService.loadActiveOrganization(),
            this.organizationService.loadOrganizations(),
            this.entitlements.load(),
          ]),
        ),
      )
      .subscribe({
        next: () => this.router.navigateByUrl('/'),
        error: (error: unknown) => {
          this.error.set(this.loginErrorMessage(error));
          this.loading.set(false);
        },
      });
  }

  /**
   * Only a 401 from the credential check means the email/password is wrong. Everything else — a
   * network outage, a 429 rate-limit, a 500, or a failure hydrating the org/entitlements after a
   * valid sign-in — must surface its real cause, otherwise a broken backend looks like bad
   * credentials and the operator retries forever.
   */
  private loginErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Invalid email or password.';
    }
    return httpErrorMessage(error);
  }
}
