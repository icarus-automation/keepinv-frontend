import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { AuthService } from '../auth/services/auth.service';

/** Where an expired-trial tenant goes to regain access (the operator's Facebook page). */
const SUBSCRIBE_URL = 'https://www.facebook.com/profile.php?id=61591016892426';

/**
 * Shown when a tenant's trial has ended (or the org was deactivated). Blocks the app and points the
 * operator to the subscribe CTA (the platform owner's Facebook page) to regain access.
 */
@Component({
  selector: 'app-locked',
  imports: [ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid min-h-dvh place-items-center bg-counter px-4 text-ink">
      <div class="w-full max-w-md rounded-lg border border-line bg-panel px-7 py-8 text-center">
        <span class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ink text-counter">
          <i class="pi pi-lock text-xl" aria-hidden="true"></i>
        </span>
        <h1 class="mt-5 text-xl font-semibold tracking-tight">Your trial has ended</h1>
        <p class="mt-2 text-sm text-muted">
          Thanks for trying keep inv. To keep using it, message us to activate your subscription —
          we'll get you back up and running.
        </p>
        <a
          [href]="subscribeUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-signal px-4 py-2.5 text-sm font-semibold text-counter outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          <i class="pi pi-facebook text-base" aria-hidden="true"></i>
          Message us to subscribe
        </a>
        <button
          type="button"
          (click)="signOut()"
          class="mt-3 inline-flex w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          Sign out
        </button>
      </div>
    </div>
  `,
})
export class Locked {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly subscribeUrl = SUBSCRIBE_URL;

  protected signOut(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/auth/login'));
  }
}
