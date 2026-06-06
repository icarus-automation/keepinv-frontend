import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

import { MoneyPipe } from '../../products/utils/money.pipe';
import { PaymentMethod, ReceiptData, paymentMethodMeta } from '../types/pos.types';

/**
 * A presentational receipt rendered from an immutable sale snapshot. Reused by the
 * sell screen's success state and the sales-ledger detail pane, so it owns no void
 * state: a voided banner is the caller's concern (the snapshot always reads
 * COMPLETED). Money and dates come pre-captured on the snapshot; we only format.
 */
@Component({
  selector: 'app-receipt',
  imports: [DatePipe, MoneyPipe],
  templateUrl: './receipt.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Receipt {
  readonly data = input.required<ReceiptData>();

  protected paymentLabel(method: PaymentMethod): string {
    return paymentMethodMeta(method).label;
  }
}
