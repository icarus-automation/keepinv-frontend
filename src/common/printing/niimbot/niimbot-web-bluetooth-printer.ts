/// <reference types="web-bluetooth" />
import { LabelBitmap, LabelPrinter, PrinterError } from '../label-printer';
import { decodePackets, NiimbotPacket } from './niimbot-packet';
import {
  bitmapRow,
  pageEnd,
  pageStart,
  printEnd,
  printStart,
  Resp,
  rowCounts,
  setDensity,
  setLabelType,
  setPageSize,
} from './niimbot-protocol';

/**
 * Niimbot's serial-over-BLE service (B-series, incl. B21) first, with common
 * fallbacks some firmware uses. We declare them all as optional services so the
 * browser grants access to whichever one this printer actually exposes.
 */
const SERVICE_UUIDS = [
  '0000e0ff-3c17-d293-8e48-14fe2e4da212', // B21-C2B and similar variants
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // classic B-series / NiimBlue default
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
];
/** B21 default print density (1..5) and gap-label type. */
const DENSITY = 3;
const LABEL_TYPE = 1;
/** Breathing room between line writes so the printer's buffer keeps up. */
const WRITE_DELAY_MS = 6;
const ACK_TIMEOUT_MS = 1500;
const FINISH_TIMEOUT_MS = 8000;

interface Waiter {
  readonly type: number;
  readonly resolve: (packet: NiimbotPacket | null) => void;
}

/** The characteristics we drive: one to write commands, one to receive responses. */
interface Channel {
  readonly writeChar: BluetoothRemoteGATTCharacteristic;
  readonly notifyChar: BluetoothRemoteGATTCharacteristic;
  /** Whether the write characteristic supports write-without-response. */
  readonly writeWithoutResponse: boolean;
}

/**
 * Drives a Niimbot B21 over the Web Bluetooth API. The only file that touches
 * `navigator.bluetooth`. Sends framed protocol packets over a single
 * notify + write-without-response characteristic and matches responses by opcode.
 */
export class NiimbotWebBluetoothPrinter implements LabelPrinter {
  private device?: BluetoothDevice;
  private writeChar?: BluetoothRemoteGATTCharacteristic;
  private notifyChar?: BluetoothRemoteGATTCharacteristic;
  private writeWithoutResponse = true;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private waiters: Waiter[] = [];
  private onDisconnect?: () => void;

  get connected(): boolean {
    return this.writeChar !== undefined && this.device?.gatt?.connected === true;
  }

  async connect(onDisconnect?: () => void): Promise<string> {
    if (!('bluetooth' in navigator)) {
      throw new PrinterError('Web Bluetooth is unavailable. Use Chrome or Edge over HTTPS.');
    }
    this.onDisconnect = onDisconnect;

    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'B' }, { namePrefix: 'D' }, { services: [SERVICE_UUIDS[0]] }],
        optionalServices: SERVICE_UUIDS,
      });
    } catch (error) {
      throw toCancellation(error);
    }

    if (!device.gatt) {
      throw new PrinterError('This device has no Bluetooth GATT support.');
    }

    this.device = device;
    device.addEventListener('gattserverdisconnected', this.handleDisconnect);

    const server = await device.gatt.connect();
    const channel = await discoverChannel(server);
    if (!channel) {
      server.disconnect();
      throw new PrinterError(
        "Couldn't find a usable Bluetooth characteristic on the printer. Make sure no " +
          'other app or your phone is connected to the B21 (close the Niimbot app and ' +
          '"Remove" it from Windows Bluetooth settings), power-cycle it, then try again.',
      );
    }

    this.writeChar = channel.writeChar;
    this.notifyChar = channel.notifyChar;
    this.writeWithoutResponse = channel.writeWithoutResponse;
    this.notifyChar.addEventListener('characteristicvaluechanged', this.handleNotification);
    await this.notifyChar.startNotifications();

    return device.name ?? 'Niimbot B21';
  }

  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.writeChar = undefined;
    this.notifyChar = undefined;
  }

  async print(bitmap: LabelBitmap): Promise<void> {
    if (!this.writeChar) {
      throw new PrinterError('Printer is not connected.');
    }

    // Setup: wait for the acks we know so rows aren't sent before the printer is ready.
    await this.transceive(setDensity(DENSITY), Resp.SET_DENSITY, 1000);
    await this.transceive(setLabelType(LABEL_TYPE), Resp.SET_LABEL_TYPE, 1000);
    await this.transceive(printStart(1, 0), Resp.PRINT_START, 1000);
    await this.transceive(pageStart(), Resp.PAGE_START, 1000);
    // SetPageSize has no distinct ack; give the printer a moment, then stream rows.
    await this.send(setPageSize(bitmap.heightDots, bitmap.widthDots, 1), 60);

    const rowBytes = bitmap.widthDots / 8;
    for (let y = 0; y < bitmap.heightDots; y++) {
      const row = bitmap.data.subarray(y * rowBytes, (y + 1) * rowBytes);
      await this.write(bitmapRow(y, row, rowCounts(row, bitmap.widthDots)));
      await sleep(WRITE_DELAY_MS);
    }

    await this.send(pageEnd(), 60);
    await this.finish();
  }

  /** Send PRINT_END until the printer acknowledges (it then feeds the label out). */
  private async finish(): Promise<void> {
    const deadline = Date.now() + FINISH_TIMEOUT_MS;
    do {
      const response = await this.transceive(printEnd(), Resp.PRINT_END, 1000);
      if (response) {
        return;
      }
      await sleep(200);
    } while (Date.now() < deadline);
    // No ack within the window: the page was already streamed, so treat this as
    // best-effort done rather than failing a label that likely printed.
  }

  /** Write a request, then wait up to `timeout` for the matching response opcode. */
  private transceive(
    request: Uint8Array<ArrayBuffer>,
    responseType: number,
    timeout = ACK_TIMEOUT_MS,
  ): Promise<NiimbotPacket | null> {
    const response = new Promise<NiimbotPacket | null>((resolve) => {
      const waiter: Waiter = { type: responseType, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) {
          this.waiters.splice(index, 1);
          resolve(null);
        }
      }, timeout);
    });
    void this.write(request);
    return response;
  }

  /** Write a packet and pause briefly (for commands without a distinct ack). */
  private async send(bytes: Uint8Array<ArrayBuffer>, delay: number): Promise<void> {
    await this.write(bytes);
    await sleep(delay);
  }

  private async write(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!this.writeChar) {
      throw new PrinterError('Printer is not connected.');
    }
    if (this.writeWithoutResponse) {
      await this.writeChar.writeValueWithoutResponse(bytes);
    } else {
      await this.writeChar.writeValue(bytes);
    }
  }

  private readonly handleNotification = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) {
      return;
    }
    const incoming = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.rxBuffer = concat(this.rxBuffer, incoming);

    const { packets, rest } = decodePackets(this.rxBuffer);
    this.rxBuffer = rest;
    for (const packet of packets) {
      if (packet.type === Resp.ERROR || packet.type === Resp.NOT_SUPPORTED) {
        continue;
      }
      const index = this.waiters.findIndex((waiter) => waiter.type === packet.type);
      if (index !== -1) {
        this.waiters.splice(index, 1)[0].resolve(packet);
      }
    }
  };

  private readonly handleDisconnect = (): void => {
    this.writeChar = undefined;
    this.notifyChar = undefined;
    this.rxBuffer = new Uint8Array(0);
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve(null);
    }
    this.onDisconnect?.();
  };
}

/**
 * Find a writable + notifiable characteristic pair across the granted services.
 * Tolerates variants: a single characteristic that does both, or separate write
 * and notify characteristics, and write-with or without response.
 */
async function discoverChannel(server: BluetoothRemoteGATTServer): Promise<Channel | undefined> {
  // Right after connecting, service discovery can briefly report nothing; retry.
  let services: BluetoothRemoteGATTService[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      services = await server.getPrimaryServices();
      if (services.length) {
        break;
      }
    } catch {
      // "No Services found" is thrown here when discovery is not ready yet.
    }
    await sleep(400);
  }

  let writeChar: BluetoothRemoteGATTCharacteristic | undefined;
  let notifyChar: BluetoothRemoteGATTCharacteristic | undefined;
  let writeWithoutResponse = true;

  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    // Logged so an unknown printer variant's UUIDs/properties can be read from the console.
    console.debug(
      '[niimbot] service',
      service.uuid,
      'characteristics',
      characteristics.map((c) => `${c.uuid} (${describeProperties(c)})`),
    );
    for (const c of characteristics) {
      if (!notifyChar && (c.properties.notify || c.properties.indicate)) {
        notifyChar = c;
      }
      if (c.properties.writeWithoutResponse) {
        // Prefer a without-response writer; it's what the protocol expects.
        if (!writeChar || !writeWithoutResponse) {
          writeChar = c;
          writeWithoutResponse = true;
        }
      } else if (c.properties.write && !writeChar) {
        writeChar = c;
        writeWithoutResponse = false;
      }
    }
  }

  return writeChar && notifyChar ? { writeChar, notifyChar, writeWithoutResponse } : undefined;
}

function describeProperties(c: BluetoothRemoteGATTCharacteristic): string {
  const p = c.properties;
  const flags: string[] = [];
  if (p.read) flags.push('read');
  if (p.write) flags.push('write');
  if (p.writeWithoutResponse) flags.push('writeNR');
  if (p.notify) flags.push('notify');
  if (p.indicate) flags.push('indicate');
  return flags.join(',');
}

function toCancellation(error: unknown): PrinterError {
  if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'AbortError')) {
    return new PrinterError('Printer selection cancelled.', true);
  }
  const message = error instanceof Error ? error.message : 'Could not reach the printer.';
  return new PrinterError(message);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
