/// <reference types="web-bluetooth" />
import { Injectable, signal } from '@angular/core';

import { PrinterError } from '../label-printer';

/**
 * BLE services generic ESC/POS thermal printers (XP-58H class) expose their raw byte channel
 * under. The chooser accepts any device; these are what we're allowed to talk to afterwards, so
 * the superset is deliberately generous.
 */
const SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

/** BLE writes are small; chunking with a breather keeps cheap printer buffers from overflowing. */
const CHUNK_BYTES = 120;
const CHUNK_GAP_MS = 15;

/** The last chosen printer's device id, so a page reload can reconnect without the chooser. */
const STORAGE_KEY = 'keepinv.receiptPrinter.deviceId';

export type ReceiptPrinterStatus =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'printing';

/**
 * The XP-58H receipt printer over Web Bluetooth. One live GATT write characteristic, exposed to
 * the app as a status signal plus two verbs: `connect()` (must run in a user gesture — it opens
 * the browser's device chooser) and `print(bytes)`. After the first successful pairing the
 * device id is remembered and `print` silently reconnects on Chromium builds that support
 * `getDevices`, so a reloaded POS keeps auto-printing without a tap.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptPrinterService {
  private device: BluetoothDevice | null = null;
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

  readonly status = signal<ReceiptPrinterStatus>(
    typeof navigator !== 'undefined' && 'bluetooth' in navigator ? 'disconnected' : 'unsupported',
  );
  readonly deviceName = signal<string | null>(null);

  get supported(): boolean {
    return this.status() !== 'unsupported';
  }

  /** Pick (or re-pick) the printer. Must be called from a user gesture. */
  async connect(): Promise<void> {
    if (!this.supported) {
      throw new PrinterError('Bluetooth printing needs Chrome or Edge over HTTPS.');
    }
    this.status.set('connecting');
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: SERVICE_UUIDS,
      });
      await this.attach(device);
      localStorage.setItem(STORAGE_KEY, device.id);
    } catch (error) {
      this.status.set(this.device ? 'ready' : 'disconnected');
      throw toReceiptPrinterError(error);
    }
  }

  /** Send a finished ESC/POS document, reconnecting to the remembered printer if needed. */
  async print(bytes: Uint8Array): Promise<void> {
    if (!this.supported) {
      throw new PrinterError('Bluetooth printing needs Chrome or Edge over HTTPS.');
    }
    if (!this.isLinkAlive()) {
      const reconnected = await this.reconnectSilently();
      if (!reconnected) {
        throw new PrinterError('Printer not connected. Tap the printer button to connect.');
      }
    }

    const characteristic = this.writeCharacteristic;
    if (!characteristic) {
      throw new PrinterError('Printer not connected. Tap the printer button to connect.');
    }

    this.status.set('printing');
    try {
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        const chunk = bytes.slice(offset, offset + CHUNK_BYTES);
        if (characteristic.properties.writeWithoutResponse) {
          await characteristic.writeValueWithoutResponse(chunk);
        } else {
          await characteristic.writeValue(chunk);
        }
        await sleep(CHUNK_GAP_MS);
      }
    } catch (error) {
      throw toReceiptPrinterError(error);
    } finally {
      this.status.set(this.isLinkAlive() ? 'ready' : 'disconnected');
    }
  }

  /**
   * Reconnect to the remembered printer without a chooser. Chromium's `getDevices` returns
   * previously granted devices; anywhere it's missing this quietly reports false and the user
   * taps the printer button once per session instead.
   */
  async reconnectSilently(): Promise<boolean> {
    if (!this.supported || this.isLinkAlive()) {
      return this.isLinkAlive();
    }
    const storedId = localStorage.getItem(STORAGE_KEY);
    const getDevices = navigator.bluetooth.getDevices?.bind(navigator.bluetooth);
    if (!storedId || !getDevices) {
      return false;
    }
    try {
      const devices = await getDevices();
      const device = devices.find((candidate) => candidate.id === storedId);
      if (!device) {
        return false;
      }
      this.status.set('connecting');
      await this.attach(device);
      return true;
    } catch {
      this.status.set('disconnected');
      return false;
    }
  }

  private async attach(device: BluetoothDevice): Promise<void> {
    if (!device.gatt) {
      throw new PrinterError('This device has no Bluetooth GATT support.');
    }

    this.detach();

    const onDisconnect = (): void => {
      device.removeEventListener('gattserverdisconnected', onDisconnect);
      if (this.device === device) {
        this.device = null;
        this.writeCharacteristic = null;
        this.status.set('disconnected');
      }
    };
    device.addEventListener('gattserverdisconnected', onDisconnect);

    const server = await device.gatt.connect();
    const characteristic = await discoverWriteCharacteristic(server);
    if (!characteristic) {
      server.disconnect();
      throw new PrinterError(
        "Couldn't find the printer's write channel. Power-cycle the printer, make sure no " +
          'other phone or app holds it, then try again.',
      );
    }

    this.device = device;
    this.writeCharacteristic = characteristic;
    this.deviceName.set(device.name ?? 'Receipt printer');
    this.status.set('ready');
  }

  private detach(): void {
    this.device?.gatt?.disconnect();
    this.device = null;
    this.writeCharacteristic = null;
  }

  private isLinkAlive(): boolean {
    return this.device?.gatt?.connected === true && this.writeCharacteristic !== null;
  }
}

/** First writable characteristic anywhere on the device — ESC/POS printers expose exactly one. */
async function discoverWriteCharacteristic(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTCharacteristic | null> {
  let services: BluetoothRemoteGATTService[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      services = await server.getPrimaryServices();
      if (services.length) {
        break;
      }
    } catch {
      // Some devices briefly report no services immediately after connection.
    }
    await sleep(400);
  }

  let fallback: BluetoothRemoteGATTCharacteristic | null = null;
  for (const service of services) {
    const characteristics = await service.getCharacteristics().catch(() => []);
    for (const characteristic of characteristics) {
      if (characteristic.properties.writeWithoutResponse) {
        return characteristic;
      }
      if (!fallback && characteristic.properties.write) {
        fallback = characteristic;
      }
    }
  }
  return fallback;
}

function toReceiptPrinterError(error: unknown): PrinterError {
  if (error instanceof PrinterError) {
    return error;
  }
  if (
    error instanceof DOMException &&
    (error.name === 'NotFoundError' || error.name === 'AbortError')
  ) {
    return new PrinterError('Printer selection cancelled.', true);
  }
  const message = error instanceof Error ? error.message : 'Could not reach the printer.';
  return new PrinterError(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
