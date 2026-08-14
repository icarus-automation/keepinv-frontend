/// <reference types="web-bluetooth" />
import {
  FrameReader,
  ReaderReport,
  ResponseFrame,
  describeFrame,
  interpretFrame,
  toHex,
} from './h103-protocol';

/**
 * GATT channel the CHAFON readers expose. The vendor's own Bluetooth integration note lists these
 * three; the AAR's constants confirm them byte for byte.
 */
export const READER_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const READER_WRITE_UUID = '0000ffe3-0000-1000-8000-00805f9b34fb';
export const READER_NOTIFY_UUID = '0000ffe4-0000-1000-8000-00805f9b34fb';

/** Device-name prefixes CHAFON ships under, used to filter the browser's chooser. */
const NAME_PREFIXES = ['H103', 'H104', 'CF', 'RFID', 'UHF'];

/** Commands are queued at least this far apart. The module drops writes that arrive back-to-back. */
const WRITE_GAP_MS = 24;

/** Why a connection attempt ended. Separated so the UI can speak plainly about each. */
export type ReaderErrorKind =
  /** Web Bluetooth is missing: wrong browser, or the page is not on HTTPS. */
  | 'unsupported'
  /** The operator closed the chooser. Not a failure; the UI stays silent. */
  | 'cancelled'
  /** The chooser opened but no reader was picked, or the device would not connect. */
  | 'unavailable'
  /** Connected, but the expected service or characteristics were not there. */
  | 'incompatible'
  /** The link dropped, or a command could not be written. */
  | 'link';

export class ReaderError extends Error {
  constructor(
    readonly kind: ReaderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ReaderError';
  }
}

/** One line in the diagnostics log: a frame in either direction. */
export interface WireEntry {
  readonly at: number;
  readonly direction: 'out' | 'in';
  readonly hex: string;
  /** Short human reading of the frame, e.g. `TAG E28011… -32 dBm` or `SET_POWER 33 dBm`. */
  readonly label: string;
  /** How many identical frames this line stands for. Absent means one. */
  readonly repeat?: number;
}

export interface TransportHandlers {
  /** A decoded report from the reader. */
  readonly onReport: (report: ReaderReport) => void;
  /** The link dropped, from either side. */
  readonly onDisconnect: () => void;
  /** Every frame in and out, for the diagnostics panel. */
  readonly onWire?: (entry: WireEntry) => void;
}

/**
 * Owns the radio link to one reader: device selection, the GATT channel, a serialised write queue,
 * and reassembly of the notification stream into decoded reports.
 *
 * Kept deliberately free of Angular so it can be exercised without a TestBed, and lazy-loaded so
 * tenants without a reader never download it.
 */
export class H103Transport {
  private device?: BluetoothDevice;
  private writeCharacteristic?: BluetoothRemoteGATTCharacteristic;
  private notifyCharacteristic?: BluetoothRemoteGATTCharacteristic;

  private readonly frames = new FrameReader();
  private handlers?: TransportHandlers;

  /** Serialises writes so two commands can never interleave on the characteristic. */
  private writeChain: Promise<void> = Promise.resolve();
  private lastWriteAt = 0;

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  get connected(): boolean {
    return this.device?.gatt?.connected === true && this.writeCharacteristic !== undefined;
  }

  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  /**
   * Open the browser's device chooser and connect to whatever the operator picks. Must be called
   * straight from a user gesture — Chrome rejects `requestDevice` otherwise.
   */
  async connect(handlers: TransportHandlers): Promise<string> {
    this.assertSupported();
    const device = await this.requestDevice();
    return this.attach(device, handlers);
  }

  /**
   * Reconnect to a reader this browser profile has already been granted, with no chooser and no
   * gesture. Returns null when the permission is gone or the reader is not in range, so a failed
   * silent reconnect can stay invisible.
   */
  async reconnectKnown(deviceId: string, handlers: TransportHandlers): Promise<string | null> {
    if (!H103Transport.supported || !navigator.bluetooth.getDevices) {
      return null;
    }
    try {
      const known = await navigator.bluetooth.getDevices();
      const device = known.find((candidate) => candidate.id === deviceId);
      if (!device) return null;
      return await this.attach(device, handlers);
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    this.detachListeners();

    try {
      await this.notifyCharacteristic?.stopNotifications();
    } catch {
      // The link may already be gone; nothing left to stop.
    }
    device?.gatt?.disconnect();

    this.device = undefined;
    this.writeCharacteristic = undefined;
    this.notifyCharacteristic = undefined;
    this.handlers = undefined;
    this.frames.reset();
  }

  /**
   * Send one command frame. Writes are queued and spaced: the module silently drops commands that
   * arrive inside its processing window, which shows up as a mode switch that never takes.
   */
  write(frame: Uint8Array): Promise<void> {
    const sent = this.writeChain.then(() => this.writeNow(frame));
    // The chain itself must never carry a rejection forward: a single failed write would otherwise
    // reject every command queued behind it for the rest of the connection. The caller still gets
    // the real outcome through `sent`.
    this.writeChain = sent.then(
      () => undefined,
      () => undefined,
    );
    return sent;
  }

  /** The device id to remember for a later silent reconnect. */
  get deviceId(): string | null {
    return this.device?.id ?? null;
  }

  private async requestDevice(): Promise<BluetoothDevice> {
    try {
      return await navigator.bluetooth.requestDevice({
        filters: [
          { services: [READER_SERVICE_UUID] },
          ...NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
        ],
        optionalServices: [READER_SERVICE_UUID],
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'AbortError')) {
        throw new ReaderError('cancelled', 'Reader selection cancelled.');
      }
      throw new ReaderError('unavailable', 'Could not open the Bluetooth device chooser.');
    }
  }

  private async attach(device: BluetoothDevice, handlers: TransportHandlers): Promise<string> {
    if (!device.gatt) {
      throw new ReaderError('incompatible', 'That device does not support Bluetooth GATT.');
    }

    this.handlers = handlers;
    this.device = device;
    this.frames.reset();
    device.addEventListener('gattserverdisconnected', this.handleDisconnect);

    let server: BluetoothRemoteGATTServer;
    try {
      server = await device.gatt.connect();
    } catch {
      this.detachListeners();
      this.device = undefined;
      throw new ReaderError(
        'unavailable',
        'Could not reach the reader. Make sure it is powered on, in range, and not connected to another phone or app.',
      );
    }

    try {
      const service = await server.getPrimaryService(READER_SERVICE_UUID);
      this.writeCharacteristic = await service.getCharacteristic(READER_WRITE_UUID);
      this.notifyCharacteristic = await service.getCharacteristic(READER_NOTIFY_UUID);
    } catch {
      server.disconnect();
      this.detachListeners();
      this.device = undefined;
      throw new ReaderError(
        'incompatible',
        'That device answered, but it is not a CHAFON UHF reader — the expected Bluetooth service is missing.',
      );
    }

    this.notifyCharacteristic.addEventListener('characteristicvaluechanged', this.handleNotification);
    await this.notifyCharacteristic.startNotifications();

    return device.name ?? 'RFID reader';
  }

  private async writeNow(frame: Uint8Array): Promise<void> {
    const characteristic = this.writeCharacteristic;
    if (!characteristic || !this.connected) {
      throw new ReaderError('link', 'The reader is not connected.');
    }

    const sinceLast = Date.now() - this.lastWriteAt;
    if (sinceLast < WRITE_GAP_MS) {
      await sleep(WRITE_GAP_MS - sinceLast);
    }

    // A fresh buffer per write: Chrome detaches the ArrayBuffer it is handed.
    const payload = new Uint8Array(frame.length);
    payload.set(frame);

    try {
      if (characteristic.properties.writeWithoutResponse) {
        await characteristic.writeValueWithoutResponse(payload);
      } else {
        await characteristic.writeValueWithResponse(payload);
      }
    } catch {
      throw new ReaderError('link', 'Lost the connection to the reader.');
    }

    this.lastWriteAt = Date.now();
    this.handlers?.onWire?.({
      at: this.lastWriteAt,
      direction: 'out',
      hex: toHex(frame),
      label: describeFrame(frame, 'out'),
    });
  }

  private readonly handleNotification = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;

    const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    for (const frame of this.frames.push(chunk)) {
      this.emit(frame);
    }
  };

  private emit(frame: ResponseFrame): void {
    this.handlers?.onWire?.({
      at: Date.now(),
      direction: 'in',
      hex: toHex(frame.raw),
      label: describeFrame(frame.raw, 'in'),
    });
    this.handlers?.onReport(interpretFrame(frame));
  }

  private readonly handleDisconnect = (): void => {
    const notify = this.handlers?.onDisconnect;
    this.detachListeners();
    this.writeCharacteristic = undefined;
    this.notifyCharacteristic = undefined;
    this.frames.reset();
    notify?.();
  };

  private detachListeners(): void {
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnect);
    this.notifyCharacteristic?.removeEventListener(
      'characteristicvaluechanged',
      this.handleNotification,
    );
  }

  private assertSupported(): void {
    if (!H103Transport.supported) {
      throw new ReaderError(
        'unsupported',
        'This browser cannot talk to Bluetooth devices. Use Chrome or Edge on a secure (https) connection.',
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
