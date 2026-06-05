import { Injectable, signal } from '@angular/core';

import { Product } from '../../app/modules/products/types/product.types';
import { LabelPrinter, PrinterError } from './label-printer';
import { productToLabelData } from './label-data';
import { B21_LABEL_50X30 } from './label-spec';

type PrintingEngine = typeof import('./printing-engine');

/** Where a print attempt currently is, for driving the button's UI. */
export type PrintPhase = 'idle' | 'connecting' | 'printing' | 'done' | 'error';

/**
 * Orchestrates label printing: lazy-loads the printing engine, holds the single
 * printer connection for the session, and exposes signal state for the UI. The
 * heavy protocol/transport/barcode code only loads on first use.
 */
@Injectable({ providedIn: 'root' })
export class LabelPrintingService {
  /** Web Bluetooth is required; absent on non-Chromium or insecure contexts. */
  readonly supported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  readonly phase = signal<PrintPhase>('idle');
  readonly error = signal<string | null>(null);
  readonly connected = signal(false);
  readonly deviceName = signal<string | null>(null);

  private enginePromise?: Promise<PrintingEngine>;
  private printer?: LabelPrinter;

  /**
   * Warm the lazy chunk ahead of the click (call on hover/focus). This keeps the
   * later `connect()` inside the user's gesture: the dynamic import is already
   * resolved, so `requestDevice` isn't blocked behind a network fetch.
   */
  preload(): void {
    if (this.supported) {
      void this.loadEngine();
    }
  }

  async printProductLabel(product: Product): Promise<void> {
    if (!this.supported) {
      this.fail('Label printing needs Chrome or Edge over HTTPS.');
      return;
    }
    if (this.phase() === 'connecting' || this.phase() === 'printing') {
      return;
    }

    this.error.set(null);
    try {
      const engine = await this.loadEngine();
      this.printer ??= engine.createPrinter();

      if (!this.printer.connected) {
        this.phase.set('connecting');
        const name = await this.printer.connect(() => this.markDisconnected());
        this.connected.set(true);
        this.deviceName.set(name);
      }

      this.phase.set('printing');
      const bitmap = engine.renderLabel(productToLabelData(product), B21_LABEL_50X30);
      await this.printer.print(bitmap);

      this.phase.set('done');
    } catch (error) {
      if (error instanceof PrinterError && error.cancelled) {
        this.phase.set('idle');
        return;
      }
      this.syncConnection();
      this.fail(error instanceof Error ? error.message : 'Could not print the label.');
    }
  }

  private loadEngine(): Promise<PrintingEngine> {
    this.enginePromise ??= import('./printing-engine');
    return this.enginePromise;
  }

  private markDisconnected(): void {
    this.connected.set(false);
    this.deviceName.set(null);
  }

  /** Reflect the transport's real connection state (e.g. after a failed print). */
  private syncConnection(): void {
    const live = this.printer?.connected ?? false;
    this.connected.set(live);
    if (!live) {
      this.deviceName.set(null);
    }
  }

  private fail(message: string): void {
    this.error.set(message);
    this.phase.set('error');
  }
}
