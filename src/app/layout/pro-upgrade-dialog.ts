import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';

/** Where BASIC tenants ask about upgrading; plans are provisioned manually by the operator. */
const FACEBOOK_PAGE_URL = 'https://www.facebook.com/profile.php?id=61582103931111';

/**
 * The friendly paywall. Shown when a BASIC tenant taps a PRO-only surface in the sidebar:
 * a small celebration ("you found something!"), what the feature does, and a single CTA to
 * message the shop's Facebook page — there is no self-service checkout.
 */
@Component({
  selector: 'app-pro-upgrade-dialog',
  imports: [DialogModule, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [dismissableMask]="true"
      [style]="{ width: 'min(26rem, calc(100vw - 2rem))' }"
      styleClass="overflow-hidden"
    >
      <ng-template #header>
        <span class="sr-only">{{ featureName() }} is a PRO feature</span>
      </ng-template>

      <div class="-mx-1 flex flex-col items-center px-1 pb-1 text-center">
        <!-- A happy little receipt, discovered. -->
        <div class="relative mt-1 grid h-32 w-32 place-items-center rounded-full bg-signal/10">
          <svg
            viewBox="0 0 96 96"
            class="upgrade-float h-24 w-24"
            role="img"
            aria-label="A smiling receipt with sparkles"
          >
            <!-- sparkles -->
            <path d="M16 22l2.2 5 5 2.2-5 2.2-2.2 5-2.2-5-5-2.2 5-2.2z" fill="var(--color-signal)" />
            <path d="M79 14l1.6 3.6 3.6 1.6-3.6 1.6-1.6 3.6-1.6-3.6-3.6-1.6 3.6-1.6z" fill="var(--color-signal)" opacity="0.7" />
            <path d="M82 58l1.4 3.2 3.2 1.4-3.2 1.4-1.4 3.2-1.4-3.2-3.2-1.4 3.2-1.4z" fill="var(--color-signal)" opacity="0.5" />
            <!-- receipt body with a torn zigzag bottom -->
            <path
              d="M32 16h32a4 4 0 0 1 4 4v54l-5-4-5 4-5-4-5 4-6-4-5 4-5-4-4 4V20a4 4 0 0 1 4-4z"
              fill="oklch(99% 0.003 75)"
              stroke="var(--color-ink)"
              stroke-width="2.5"
              stroke-linejoin="round"
            />
            <!-- face -->
            <circle cx="41" cy="34" r="2.4" fill="var(--color-ink)" />
            <circle cx="55" cy="34" r="2.4" fill="var(--color-ink)" />
            <path d="M41 42c2.2 3 11.8 3 14 0" fill="none" stroke="var(--color-ink)" stroke-width="2.5" stroke-linecap="round" />
            <!-- receipt lines -->
            <path d="M38 54h20M38 60h20M38 66h12" stroke="var(--color-line)" stroke-width="2.5" stroke-linecap="round" />
          </svg>
          <span
            class="absolute -bottom-1 rounded-full border border-signal/40 bg-counter px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-ink"
          >
            PRO
          </span>
        </div>

        <h2 class="mt-5 text-lg font-semibold tracking-tight text-ink">
          You found a PRO feature!
        </h2>
        <p class="mt-2 max-w-xs text-sm leading-relaxed text-muted">
          <span class="font-medium text-ink">{{ featureName() }}</span> {{ description() }}
          It's included in the PRO plan.
        </p>

        <a
          [href]="facebookUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-signal px-5 text-sm font-semibold text-ink outline-none transition-colors hover:bg-signal-hover focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-counter"
        >
          <i class="pi pi-facebook text-base" aria-hidden="true"></i>
          Message us on Facebook
        </a>
        <button
          type="button"
          (click)="visible.set(false)"
          class="mt-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-counter"
        >
          Maybe later
        </button>
      </div>
    </p-dialog>
  `,
  styles: `
    @keyframes upgrade-float {
      from { transform: translateY(2px); }
      to { transform: translateY(-3px); }
    }
    .upgrade-float {
      animation: upgrade-float 2.4s ease-in-out infinite alternate;
    }
    @media (prefers-reduced-motion: reduce) {
      .upgrade-float { animation: none; }
    }
  `,
})
export class ProUpgradeDialog {
  readonly visible = model(false);
  readonly featureName = input('Scan Receipt');
  readonly description = input(
    'reads a photo of your supplier receipt and records the stock for you — no retyping.',
  );
  protected readonly facebookUrl = FACEBOOK_PAGE_URL;
}
