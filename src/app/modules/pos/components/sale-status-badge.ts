import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { SaleStatus, saleStatusMeta } from '../types/pos.types';

/**
 * Tone to concrete utility classes. Kept as literals so Tailwind detects them.
 * No amber: a status badge must never compete with the one signal colour.
 */
const TONE_CLASSES: Record<string, string> = {
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
};

/** A small, self-labelling status pill for a sale (icon + word + tint). */
@Component({
  selector: 'app-sale-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
      [class]="classes()"
    >
      <i [class]="meta().icon" class="text-[0.7rem]" aria-hidden="true"></i>
      {{ meta().label }}
    </span>
  `,
})
export class SaleStatusBadge {
  readonly status = input.required<SaleStatus>();
  protected readonly meta = computed(() => saleStatusMeta(this.status()));
  protected readonly classes = computed(() => TONE_CLASSES[this.meta().tone]);
}
