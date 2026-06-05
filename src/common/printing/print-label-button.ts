import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { Product } from '../../app/modules/products/types/product.types';
import { LabelPrintingService } from './label-printing.service';

/**
 * Prints a product's label on the Niimbot B21 over Web Bluetooth. Shown after a
 * product is registered and on the product detail view (reprint). Warms the lazy
 * printing chunk on hover/focus so the click can open the device chooser within
 * the user gesture. Falls back to a clear message where Web Bluetooth is absent.
 */
@Component({
  selector: 'app-print-label-button',
  imports: [ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!supported) {
      <p class="text-xs text-muted">Label printing needs Chrome or Edge over HTTPS.</p>
    } @else {
      <p-button
        type="button"
        icon="pi pi-print"
        [label]="label()"
        [outlined]="true"
        size="small"
        [loading]="busy()"
        [disabled]="busy()"
        (onClick)="print()"
        (pointerenter)="preload()"
        (focusin)="preload()"
        styleClass="font-medium"
      />
      @if (phase() === 'error' && error()) {
        <p role="alert" class="mt-1 text-xs text-danger">{{ error() }}</p>
      } @else if (phase() === 'done') {
        <p class="mt-1 text-xs text-muted">Label sent to the printer.</p>
      }
    }
  `,
})
export class PrintLabelButton {
  private readonly printing = inject(LabelPrintingService);

  readonly product = input.required<Product>();

  protected readonly supported = this.printing.supported;
  protected readonly phase = this.printing.phase;
  protected readonly error = this.printing.error;
  protected readonly connected = this.printing.connected;

  protected readonly busy = computed(
    () => this.phase() === 'connecting' || this.phase() === 'printing',
  );

  protected readonly label = computed(() => {
    switch (this.phase()) {
      case 'connecting':
        return 'Connecting…';
      case 'printing':
        return 'Printing…';
      default:
        return this.connected() ? 'Print label' : 'Connect & print label';
    }
  });

  protected preload(): void {
    this.printing.preload();
  }

  protected print(): void {
    void this.printing.printProductLabel(this.product());
  }
}
