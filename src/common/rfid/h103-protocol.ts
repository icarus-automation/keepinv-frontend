/**
 * Wire protocol for CHAFON UHF handheld readers (H103 SE-2D and siblings), spoken directly over
 * Web Bluetooth instead of through the vendor's Android AAR.
 *
 * Frame layout, identical in both directions:
 *
 *   HEAD  ADDR  CMD    LEN   [STATUS]  DATA…      CRC16
 *   0xCF  1B    2B BE  1B    1B*       LEN-1 B    2B, high byte first
 *                                       (* responses only; commands have no STATUS)
 *
 * So a whole frame is always `7 + LEN` bytes. CRC-16 covers HEAD through the last DATA byte and is
 * the reflected 0x8408 variant preset to 0xFFFF (see the vendor manual, Appendix B).
 *
 * Everything here is pure: no DOM, no Bluetooth, no Angular. The transport layer owns the radio.
 */

/** Frame start byte, used for resynchronisation as much as for framing. */
const HEAD = 0xcf;
/** Broadcast address. Commands go out on 0xFF; the reader answers on its own address (0x00). */
const ADDR_BROADCAST = 0xff;
/** Bytes of framing around DATA: HEAD + ADDR + CMD(2) + LEN + CRC(2). */
const FRAME_OVERHEAD = 7;
/** Enough header to know how long the frame will be: HEAD + ADDR + CMD(2) + LEN. */
const HEADER_BYTES = 5;

const CRC_PRESET = 0xffff;
const CRC_POLYNOMIAL = 0x8408;

/** Command codes. Values confirmed against both the manual's command list and the shipped SDK. */
export const Cmd = {
  INVENTORY: 0x0001,
  STOP_INVENTORY: 0x0002,
  MODULE_INIT: 0x0050,
  SET_POWER: 0x0053,
  GET_DEVICE_INFO: 0x0070,
  GET_BATTERY: 0x0083,
  OUTPUT_MODE: 0x0088,
  KEY_STATE: 0x0089,
  READ_MODE: 0x008e,
} as const;

/** Response STATUS values this driver acts on. Full table in the manual, Appendix C. */
export const Status = {
  /** A tag (or barcode) is in the payload. */
  OK: 0x00,
  /** Parameter rejected. */
  BAD_PARAM: 0x01,
  /** Internal module failure. */
  MODULE_ERROR: 0x02,
  /** Inventory round finished with nothing new — the normal idle heartbeat during a sweep. */
  INVENTORY_IDLE: 0x12,
} as const;

/** What the reader's front end is currently listening to. */
export type ReadMode = 'rfid' | 'barcode';

/** How the reader emits captured data: as a Bluetooth keyboard, or over this GATT channel. */
export type OutputMode = 'hid' | 'transparent';

const READ_MODE_BYTE: Record<ReadMode, number> = { rfid: 0x00, barcode: 0x01 };
const OUTPUT_MODE_BYTE: Record<OutputMode, number> = { hid: 0x00, transparent: 0x01 };

/** Radio power bounds in dBm. The module clamps anything above 26. */
export const MIN_POWER_DBM = 0;
export const MAX_POWER_DBM = 26;

// --- Building commands ---------------------------------------------------------------------

/**
 * CRC-16 over `bytes[0 .. length)`. Reflected algorithm: the polynomial is applied on the way out
 * of the low bit, so no input or output reflection step is needed.
 */
export function crc16(bytes: Uint8Array, length = bytes.length): number {
  let crc = CRC_PRESET;
  for (let i = 0; i < length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x0001 ? (crc >> 1) ^ CRC_POLYNOMIAL : crc >> 1;
    }
  }
  return crc & 0xffff;
}

/** Assemble a command frame: header, payload, then the CRC over everything before it. */
export function buildFrame(cmd: number, data: readonly number[] = []): Uint8Array {
  const frame = new Uint8Array(FRAME_OVERHEAD + data.length);
  frame[0] = HEAD;
  frame[1] = ADDR_BROADCAST;
  frame[2] = (cmd >> 8) & 0xff;
  frame[3] = cmd & 0xff;
  frame[4] = data.length & 0xff;
  frame.set(data, HEADER_BYTES);

  const crc = crc16(frame, frame.length - 2);
  frame[frame.length - 2] = (crc >> 8) & 0xff;
  frame[frame.length - 1] = crc & 0xff;
  return frame;
}

/** How long a sweep runs once started. */
export type SweepPlan =
  /** Read until an explicit stop. The only sane choice for a shelf sweep. */
  | { readonly kind: 'continuous' }
  /** Read for `seconds`, then stop on its own. */
  | { readonly kind: 'timed'; readonly seconds: number }
  /** Run `rounds` anti-collision cycles, then stop. One round ≈ a single trigger tap. */
  | { readonly kind: 'rounds'; readonly rounds: number };

/**
 * Start an ISO 18000-6C inventory. The reader streams one response per tag it resolves, plus a
 * `0x12` heartbeat whenever a round completes with nothing new.
 */
export function startInventory(plan: SweepPlan = { kind: 'continuous' }): Uint8Array {
  const invType = plan.kind === 'rounds' ? 0x01 : 0x00;
  const param = plan.kind === 'timed' ? plan.seconds : plan.kind === 'rounds' ? plan.rounds : 0;
  const clamped = Math.max(0, Math.min(0xffffffff, Math.trunc(param)));
  return buildFrame(Cmd.INVENTORY, [
    invType,
    (clamped >>> 24) & 0xff,
    (clamped >>> 16) & 0xff,
    (clamped >>> 8) & 0xff,
    clamped & 0xff,
  ]);
}

export function stopInventory(): Uint8Array {
  return buildFrame(Cmd.STOP_INVENTORY);
}

/**
 * Switch the front end between the UHF radio and the 2D barcode engine. The manual notes the
 * module needs about a second to come back up after this, so callers should settle before reading.
 */
export function setReadMode(mode: ReadMode): Uint8Array {
  return buildFrame(Cmd.READ_MODE, [0x01, READ_MODE_BYTE[mode], 0, 0, 0, 0, 0, 0, 0]);
}

export function getReadMode(): Uint8Array {
  return buildFrame(Cmd.READ_MODE, [0x02]);
}

/**
 * Choose where captured data goes. `transparent` is required for this driver: in `hid` the reader
 * types its reads as a Bluetooth keyboard and nothing arrives on the GATT channel.
 */
export function setOutputMode(mode: OutputMode): Uint8Array {
  return buildFrame(Cmd.OUTPUT_MODE, [0x01, OUTPUT_MODE_BYTE[mode]]);
}

export function getOutputMode(): Uint8Array {
  return buildFrame(Cmd.OUTPUT_MODE, [0x02]);
}

/**
 * Set radio output power in dBm. Low power is a precision tool, not a limitation: at the bottom of
 * the range only a tag held at the antenna answers, which is exactly what commissioning wants.
 */
export function setPower(dbm: number): Uint8Array {
  const clamped = Math.max(MIN_POWER_DBM, Math.min(MAX_POWER_DBM, Math.round(dbm)));
  return buildFrame(Cmd.SET_POWER, [clamped, 0x00]);
}

export function getBattery(): Uint8Array {
  return buildFrame(Cmd.GET_BATTERY);
}

export function getDeviceInfo(): Uint8Array {
  return buildFrame(Cmd.GET_DEVICE_INFO);
}

// --- Reading responses ---------------------------------------------------------------------

/** A CRC-checked response frame, split into its parts. */
export interface ResponseFrame {
  readonly address: number;
  readonly cmd: number;
  readonly status: number;
  /** Payload after STATUS. Empty for acknowledgements. */
  readonly data: Uint8Array;
  /** The whole frame, for the diagnostics log. */
  readonly raw: Uint8Array;
}

/** One tag seen during a sweep. */
export interface TagRead {
  readonly kind: 'tag';
  /** EPC as uppercase hex, no separators. This is the value the catalog stores. */
  readonly epc: string;
  /**
   * Signal strength in dBm, always negative; closer to zero means nearer the antenna. The wire
   * carries tenths of a dBm as a signed 16-bit value (0xFEC0 = -32.0 dBm), matching how the
   * vendor SDK reads the field.
   */
  readonly rssi: number;
  readonly antenna: number;
  readonly channel: number;
}

/** One barcode read by the 2D engine. */
export interface BarcodeRead {
  readonly kind: 'barcode';
  /** Decoded symbol text, already stripped of its STX/ETX/CR framing. */
  readonly value: string;
}

/** The reader finished an inventory round without resolving anything new. */
export interface InventoryIdle {
  readonly kind: 'idle';
}

/** The physical trigger was pressed or released. */
export interface TriggerEvent {
  readonly kind: 'trigger';
  readonly pressed: boolean;
}

export interface BatteryReport {
  readonly kind: 'battery';
  /** Charge percentage, 0–100. */
  readonly percent: number;
}

export interface ReadModeReport {
  readonly kind: 'readMode';
  readonly mode: ReadMode;
}

export interface OutputModeReport {
  readonly kind: 'outputMode';
  readonly mode: OutputMode;
}

/** A command the reader rejected, or a frame this driver does not model. */
export interface UnhandledReport {
  readonly kind: 'other';
  readonly cmd: number;
  readonly status: number;
}

export type ReaderReport =
  | TagRead
  | BarcodeRead
  | InventoryIdle
  | TriggerEvent
  | BatteryReport
  | ReadModeReport
  | OutputModeReport
  | UnhandledReport;

/** Barcode payloads arrive wrapped in STX … ETX CR. Tag EPCs are raw bytes. */
const STX = 0x02;
const ETX = 0x03;
const CR = 0x0d;

/**
 * Interpret one CRC-checked frame.
 *
 * The barcode engine and the UHF radio share command 0x0001, so a read on that command has to be
 * told apart by its payload: a barcode is wrapped in STX/ETX/CR *and* reports zero RSSI, antenna,
 * and channel, because those fields do not apply to it. A genuine tag read always carries a
 * non-zero (negative) RSSI, so requiring both signals leaves no realistic ambiguity.
 */
export function interpretFrame(frame: ResponseFrame): ReaderReport {
  switch (frame.cmd) {
    case Cmd.INVENTORY:
      return interpretInventory(frame);

    case Cmd.KEY_STATE:
      // The trigger reports 0x01 on press and 0x02 on release.
      return { kind: 'trigger', pressed: frame.data[0] === 0x01 };

    case Cmd.GET_BATTERY:
      return {
        kind: 'battery',
        percent: Math.max(0, Math.min(100, frame.data[0] ?? 0)),
      };

    case Cmd.READ_MODE:
      // Only the read-back carries a mode byte; a set just acknowledges.
      return frame.data.length > 0
        ? { kind: 'readMode', mode: frame.data[0] === 0x01 ? 'barcode' : 'rfid' }
        : { kind: 'other', cmd: frame.cmd, status: frame.status };

    case Cmd.OUTPUT_MODE:
      return frame.data.length > 0
        ? { kind: 'outputMode', mode: frame.data[0] === 0x01 ? 'transparent' : 'hid' }
        : { kind: 'other', cmd: frame.cmd, status: frame.status };

    default:
      return { kind: 'other', cmd: frame.cmd, status: frame.status };
  }
}

function interpretInventory(frame: ResponseFrame): ReaderReport {
  if (frame.status !== Status.OK) {
    // 0x12 is the ordinary "round finished, nothing new" beat, not an error.
    return frame.status === Status.INVENTORY_IDLE
      ? { kind: 'idle' }
      : { kind: 'other', cmd: frame.cmd, status: frame.status };
  }

  const { data } = frame;
  // RSSI(2) ANT(1) CHANNEL(1) LEN(1) then the payload itself.
  if (data.length < 5) {
    return { kind: 'other', cmd: frame.cmd, status: frame.status };
  }

  const rssi = signed16((data[0] << 8) | data[1]) / 10;
  const antenna = data[2];
  const channel = data[3];
  const payloadLength = data[4];
  const payload = data.subarray(5, 5 + payloadLength);

  if (payload.length === 0) {
    return { kind: 'other', cmd: frame.cmd, status: frame.status };
  }

  if (isBarcodePayload(payload, rssi, antenna, channel)) {
    return { kind: 'barcode', value: decodeBarcode(payload) };
  }

  return { kind: 'tag', epc: toHex(payload), rssi, antenna, channel };
}

function isBarcodePayload(
  payload: Uint8Array,
  rssi: number,
  antenna: number,
  channel: number,
): boolean {
  if (rssi !== 0 || antenna !== 0 || channel !== 0) return false;
  if (payload.length < 4) return false;
  return (
    payload[0] === STX && payload[payload.length - 2] === ETX && payload[payload.length - 1] === CR
  );
}

/** Strip the STX … ETX CR wrapper and read the middle as ASCII. */
function decodeBarcode(payload: Uint8Array): string {
  const body = payload.subarray(1, payload.length - 2);
  let value = '';
  for (const byte of body) {
    value += String.fromCharCode(byte);
  }
  return value.trim();
}

function signed16(value: number): number {
  return value >= 0x8000 ? value - 0x10000 : value;
}

/**
 * The canonical EPC form used everywhere in this app and stored on `ProductUnit.rfidTag`:
 * uppercase hex, two characters per byte, no separators or prefix.
 */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0').toUpperCase();
  }
  return hex;
}

/**
 * Reduce a tag to its comparison form so values captured through different paths still match:
 * separators dropped, uppercased. Mirrors the backend inspection script's normaliser.
 */
export function normalizeTag(value: string): string {
  return value.replace(/[\s:-]/g, '').toUpperCase();
}

// --- Reassembling the notification stream ---------------------------------------------------

/**
 * A frame is routinely split across BLE notifications, and several short frames routinely arrive
 * in one. This buffers the byte stream and emits whole, CRC-checked frames.
 *
 * Resynchronisation matters more than it looks: 0xCF can appear inside an EPC, so a byte that
 * *looks* like a frame start may not be one. When a candidate frame fails its CRC the buffer drops
 * a single byte and rescans from there, rather than discarding everything and losing real reads.
 */
export class FrameReader {
  /** Guard against a desynchronised stream growing without bound. Far above any real frame. */
  private static readonly MAX_BUFFERED = 4096;

  private buffer = new Uint8Array(0);

  /** Frames dropped because their CRC did not verify. Surfaced in diagnostics. */
  private corruptFrames = 0;

  get corruptCount(): number {
    return this.corruptFrames;
  }

  /** Feed one notification's bytes; get back every complete frame they finished. */
  push(chunk: Uint8Array): ResponseFrame[] {
    this.append(chunk);

    const frames: ResponseFrame[] = [];
    let offset = 0;

    while (offset < this.buffer.length) {
      const start = this.buffer.indexOf(HEAD, offset);
      if (start === -1) {
        // Nothing frame-like left; drop the noise.
        offset = this.buffer.length;
        break;
      }

      const available = this.buffer.length - start;
      if (available < HEADER_BYTES) {
        offset = start;
        break;
      }

      const total = FRAME_OVERHEAD + this.buffer[start + 4];
      if (available < total) {
        offset = start;
        break;
      }

      const candidate = this.buffer.subarray(start, start + total);
      const expected = (candidate[total - 2] << 8) | candidate[total - 1];
      if (crc16(candidate, total - 2) !== expected) {
        this.corruptFrames++;
        // A false start byte: step past it and look for the next candidate.
        offset = start + 1;
        continue;
      }

      frames.push(toResponseFrame(candidate));
      offset = start + total;
    }

    this.buffer = this.buffer.slice(offset);
    if (this.buffer.length > FrameReader.MAX_BUFFERED) {
      this.buffer = new Uint8Array(0);
    }
    return frames;
  }

  /** Forget any partial frame. Call on connect and on mode changes. */
  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  private append(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
  }
}

function toResponseFrame(frame: Uint8Array): ResponseFrame {
  const length = frame[4];
  // A zero-length response carries no STATUS byte; treat it as a bare acknowledgement.
  const status = length > 0 ? frame[HEADER_BYTES] : Status.OK;
  const data = length > 0 ? frame.slice(HEADER_BYTES + 1, HEADER_BYTES + length) : new Uint8Array(0);
  return {
    address: frame[1],
    cmd: (frame[2] << 8) | frame[3],
    status,
    data,
    raw: frame.slice(),
  };
}
