/// <reference types="web-bluetooth" />
import {
  ConnectEvent,
  ConnectResult,
  DisconnectEvent,
  ImageEncoder,
  LabelType,
  NiimbotAbstractClient,
  PrintError as NiimbotPrintError,
  PrinterModel,
  RawPacketSentEvent,
  findPrintTask,
  getPrinterMetaByModel,
} from '@mmote/niimbluelib';
import type { PrintDirection, PrintTaskName } from '@mmote/niimbluelib';

import { LabelBitmap, LabelPrinter, PrinterError } from '../label-printer';

const SERVICE_UUIDS = [
  '0000e0ff-3c17-d293-8e48-14fe2e4da212',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
];

const B21_MODEL_ID = getPrinterMetaByModel(PrinterModel.B21)?.id[0] ?? 768;
const B21_C2B_MODEL_ID = getPrinterMetaByModel(PrinterModel.B21_C2B)?.id[0] ?? 771;
const FALLBACK_PRINT_TASK = findPrintTask(PrinterModel.B21_C2B) ?? 'B1';
const FALLBACK_PRINT_DIRECTION = getPrinterMetaByModel(PrinterModel.B21_C2B)?.printDirection ?? 'top';
const DENSITY = 3;
const PACKET_INTERVAL_MS = 6;
const PAGE_TIMEOUT_MS = 10_000;
const STATUS_POLL_MS = 300;
const STATUS_TIMEOUT_MS = 12_000;
const B1_PRINT_END_DELAY_MS = 500;

interface Channel {
  readonly writeChar: BluetoothRemoteGATTCharacteristic;
  readonly notifyChar: BluetoothRemoteGATTCharacteristic;
}

export class NiimbotWebBluetoothPrinter implements LabelPrinter {
  private readonly client = new KeepInvNiimbotBluetoothClient();
  private onDisconnect?: () => void;

  constructor() {
    this.client.setPacketInterval(PACKET_INTERVAL_MS);
    this.client.on('disconnect', () => this.onDisconnect?.());
  }

  get connected(): boolean {
    return this.client.isConnected();
  }

  async connect(onDisconnect?: () => void): Promise<string> {
    if (!('bluetooth' in navigator)) {
      throw new PrinterError('Web Bluetooth is unavailable. Use Chrome or Edge over HTTPS.');
    }

    this.onDisconnect = onDisconnect;
    try {
      const info = await this.client.connect();
      return info.deviceName ?? 'Niimbot B21';
    } catch (error) {
      throw toPrinterError(error);
    }
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async print(bitmap: LabelBitmap): Promise<void> {
    validateBitmap(bitmap);

    if (!this.connected) {
      throw new PrinterError('Printer is not connected.');
    }

    const canvas = bitmapToCanvas(bitmap);
    const taskName = this.printTaskName();
    const encoded = ImageEncoder.encodeCanvas(canvas, this.printDirection());
    const task = this.client.abstraction.newPrintTask(taskName, {
      labelType: LabelType.WithGaps,
      density: DENSITY,
      totalPages: 1,
      pageTimeoutMs: PAGE_TIMEOUT_MS,
      statusPollIntervalMs: STATUS_POLL_MS,
      statusTimeoutMs: STATUS_TIMEOUT_MS,
    });

    this.client.stopHeartbeat();
    try {
      await task.printInit();
      await task.printPage(encoded, 1);

      if (taskName === 'B1') {
        await sleep(B1_PRINT_END_DELAY_MS);
        await task.printEnd().catch(() => false);
        return;
      }

      await task.waitForFinished();
    } catch (error) {
      throw toPrinterError(error);
    } finally {
      if (taskName !== 'B1') {
        await task.printEnd().catch(() => false);
      }
      if (this.connected) {
        this.client.startHeartbeat();
      }
    }
  }

  private printTaskName(): PrintTaskName {
    return this.client.getPrintTaskType() ?? FALLBACK_PRINT_TASK;
  }

  private printDirection(): PrintDirection {
    return this.client.getModelMetadata()?.printDirection ?? FALLBACK_PRINT_DIRECTION;
  }
}

class KeepInvNiimbotBluetoothClient extends NiimbotAbstractClient {
  private device?: BluetoothDevice;
  private gattServer?: BluetoothRemoteGATTServer;
  private writeChar?: BluetoothRemoteGATTCharacteristic;
  private notifyChar?: BluetoothRemoteGATTCharacteristic;

  override async connect(): Promise<{ deviceName?: string; result: ConnectResult }> {
    await this.disconnect();

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'B' }, { namePrefix: 'D' }, { services: [SERVICE_UUIDS[0]] }],
      optionalServices: SERVICE_UUIDS,
    });
    if (!device.gatt) {
      throw new Error('Device has no Bluetooth GATT support.');
    }

    const onDisconnect = (): void => {
      this.gattServer = undefined;
      this.writeChar = undefined;
      this.notifyChar = undefined;
      this.info = {};
      this.emit('disconnect', new DisconnectEvent());
      device.removeEventListener('gattserverdisconnected', onDisconnect);
    };
    device.addEventListener('gattserverdisconnected', onDisconnect);

    const server = await device.gatt.connect();
    const channel = await discoverChannel(server);
    if (!channel) {
      server.disconnect();
      throw new Error(
        "Couldn't find a usable Bluetooth characteristic on the printer. Make sure no " +
          'other app or your phone is connected to it, then power-cycle the printer and try again.',
      );
    }

    channel.notifyChar.addEventListener('characteristicvaluechanged', this.handleNotification);
    await channel.notifyChar.startNotifications();

    this.device = device;
    this.gattServer = server;
    this.writeChar = channel.writeChar;
    this.notifyChar = channel.notifyChar;

    await this.negotiateBestEffort(device.name);

    const result = {
      deviceName: device.name,
      result: this.info.connectResult ?? ConnectResult.Connected,
    };
    this.emit('connect', new ConnectEvent(result));
    return result;
  }

  override async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.notifyChar?.removeEventListener('characteristicvaluechanged', this.handleNotification);
    this.gattServer?.disconnect();
    this.device = undefined;
    this.gattServer = undefined;
    this.writeChar = undefined;
    this.notifyChar = undefined;
    this.info = {};
  }

  override isConnected(): boolean {
    return this.gattServer !== undefined && this.writeChar !== undefined && this.device?.gatt?.connected === true;
  }

  override async sendRaw(data: Uint8Array, force?: boolean): Promise<void> {
    const send = async (): Promise<void> => {
      if (!this.writeChar) {
        throw new Error('Printer channel is closed.');
      }

      await sleep(PACKET_INTERVAL_MS);
      await this.writeChar.writeValueWithoutResponse(copyBytes(data));
      this.emit('rawpacketsent', new RawPacketSentEvent(data));
    };

    if (force) {
      await send();
      return;
    }

    await this.mutex.runExclusive(send);
  }

  private async negotiateBestEffort(deviceName?: string): Promise<void> {
    try {
      await this.initialNegotiate();
      await this.fetchPrinterInfo();
    } catch {
      this.info.modelId ??= modelIdFromDeviceName(deviceName);
      this.info.protocolVersion ??= 0;
      this.info.connectResult ??= ConnectResult.Connected;
    }
  }

  private readonly handleNotification = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (value) {
      this.processRawPacket(value);
    }
  };
}

async function discoverChannel(server: BluetoothRemoteGATTServer): Promise<Channel | undefined> {
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

  let writeChar: BluetoothRemoteGATTCharacteristic | undefined;
  let notifyChar: BluetoothRemoteGATTCharacteristic | undefined;
  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    for (const c of characteristics) {
      if (!notifyChar && (c.properties.notify || c.properties.indicate)) {
        notifyChar = c;
      }
      if (!writeChar && c.properties.writeWithoutResponse) {
        writeChar = c;
      }
      if (c.properties.notify && c.properties.writeWithoutResponse) {
        return { writeChar: c, notifyChar: c };
      }
    }
  }

  return writeChar && notifyChar ? { writeChar, notifyChar } : undefined;
}

function modelIdFromDeviceName(deviceName?: string): number {
  const normalized = deviceName?.replace(/[-_\s]/g, '').toUpperCase() ?? '';
  return normalized.startsWith('B21C2B') ? B21_C2B_MODEL_ID : B21_MODEL_ID;
}

function validateBitmap(bitmap: LabelBitmap): void {
  if (bitmap.widthDots <= 0 || bitmap.heightDots <= 0) {
    throw new PrinterError('Label bitmap has invalid dimensions.');
  }
  if (bitmap.widthDots % 8 !== 0) {
    throw new PrinterError('Label bitmap width must be a multiple of 8 dots.');
  }

  const expectedLength = (bitmap.widthDots / 8) * bitmap.heightDots;
  if (bitmap.data.length !== expectedLength) {
    throw new PrinterError('Label bitmap data does not match its dimensions.');
  }
  if (!bitmap.data.some((byte) => byte !== 0)) {
    throw new PrinterError('Label bitmap is empty.');
  }
}

function bitmapToCanvas(bitmap: LabelBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.widthDots;
  canvas.height = bitmap.heightDots;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new PrinterError('Canvas 2D context is unavailable.');
  }

  const image = ctx.createImageData(bitmap.widthDots, bitmap.heightDots);
  const rowBytes = bitmap.widthDots / 8;
  for (let y = 0; y < bitmap.heightDots; y++) {
    for (let x = 0; x < bitmap.widthDots; x++) {
      const byte = bitmap.data[y * rowBytes + (x >> 3)];
      const dark = (byte & (0x80 >> (x & 7))) !== 0;
      const i = (y * bitmap.widthDots + x) * 4;
      const value = dark ? 0 : 255;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function toPrinterError(error: unknown): PrinterError {
  if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'AbortError')) {
    return new PrinterError('Printer selection cancelled.', true);
  }
  if (error instanceof NiimbotPrintError) {
    return new PrinterError(error.message);
  }
  if (error instanceof PrinterError) {
    return error;
  }

  const message = error instanceof Error ? error.message : 'Could not print the label.';
  return new PrinterError(message);
}

function copyBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
