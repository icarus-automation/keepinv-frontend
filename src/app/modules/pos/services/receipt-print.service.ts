import { Injectable, inject } from '@angular/core';

import { OrganizationService } from '../../organization/services/organization.service';
import {
  ReceiptPrinterService,
} from '../../../../common/printing/receipt/receipt-printer.service';
import {
  SlipData,
  renderKitchenSlip,
  renderQueueStub,
} from '../../../../common/printing/receipt/receipt-slips';
import { ReceiptData } from '../types/pos.types';

/**
 * Turns a sale's receipt snapshot into paper on the XP-58H, as two separate jobs: the kitchen
 * slip (auto-printed so no order is missed) and the customer's number-only queue stub (printed
 * on demand, so staff hand it over only when a customer needs their number). Owns the mapping
 * from {@link ReceiptData} to the printer's slip shape — the sell screen and the sales-ledger
 * detail both print through here, so the paper always reads the same.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptPrintService {
  private readonly printer = inject(ReceiptPrinterService);
  private readonly organization = inject(OrganizationService);

  readonly status = this.printer.status;
  readonly deviceName = this.printer.deviceName;

  get supported(): boolean {
    return this.printer.supported;
  }

  /** Open the browser's device chooser. Must be called from a user gesture. */
  connect(): Promise<void> {
    return this.printer.connect();
  }

  /** Try to re-link the remembered printer without a chooser (safe to fire on screen entry). */
  reconnectSilently(): Promise<boolean> {
    return this.printer.reconnectSilently();
  }

  /** The kitchen slip for one sale (the auto-print). Throws `PrinterError` when paper can't happen. */
  printSlip(receipt: ReceiptData): Promise<void> {
    return this.printer.print(renderKitchenSlip(this.toSlipData(receipt)));
  }

  /** The customer's number-only stub — printed on demand, handed to whoever's waiting. */
  printStub(receipt: ReceiptData): Promise<void> {
    return this.printer.print(renderQueueStub(this.toSlipData(receipt)));
  }

  /** Print from a user gesture: re-link silently, open the chooser if that fails, then print. */
  async printSlipInteractive(receipt: ReceiptData): Promise<void> {
    await this.ensureConnectedInteractive();
    await this.printSlip(receipt);
  }

  async printStubInteractive(receipt: ReceiptData): Promise<void> {
    await this.ensureConnectedInteractive();
    await this.printStub(receipt);
  }

  private async ensureConnectedInteractive(): Promise<void> {
    const status = this.status();
    if (status === 'ready' || status === 'printing') {
      return;
    }
    if (await this.reconnectSilently()) {
      return;
    }
    await this.connect();
  }

  private toSlipData(receipt: ReceiptData): SlipData {
    return {
      shopName: this.organization.organization()?.name?.trim() || 'keep inv',
      // Old snapshots predate order numbers; the receipt number's tail still identifies the sale.
      orderLabel:
        receipt.orderNo != null ? `#${receipt.orderNo}` : `#${receipt.receiptNo.slice(-6)}`,
      dateTime: new Date(receipt.completedAt).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }),
      items: receipt.items.map((item) => ({ name: item.name, quantity: item.quantity })),
      total: receipt.totals.total,
      note: receipt.note,
    };
  }
}
