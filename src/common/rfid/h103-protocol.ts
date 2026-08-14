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
  SELECT_MASK: 0x0007,
  MODULE_INIT: 0x0050,
  SET_POWER: 0x0053,
  /**
   * Per-antenna enable + power. Undocumented in the manual's command list, but present in the
   * vendor SDK — and distinct from SET_POWER: a module whose antenna is disabled here will run an
   * inventory perfectly happily and never detect a tag.
   */
  ANT_POWER: 0x0063,
  GET_DEVICE_INFO: 0x0070,
  SET_ALL_PARAM: 0x0071,
  GET_ALL_PARAM: 0x0072,
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

/**
 * Radio power bounds in dBm, per the manual's RFM_SET_PWR table: H100 is [1,20], H102 is [1,26],
 * and **H103 is [1,33]**. Note the floor is 1, not 0 — the module answers `0x01` (parameter error)
 * to a zero power, which silently leaves the radio at whatever it had.
 *
 * The vendor SDK's javadoc says [0,26]; that documents the H102 and is wrong for this reader.
 */
export const MIN_POWER_DBM = 1;
/**
 * 30, not 33. RFM_SET_PWR's table allows the H103 up to 33, but RFM_SET_ALL_PARAM documents its
 * `RfidPower` field as `[0, 30] dBm, others are invalid` — and that is the command that actually
 * configures the module. A value the two paths disagree on gets rejected by one of them, so the
 * ceiling is the lower of the two.
 */
export const MAX_POWER_DBM = 30;

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

/**
 * Bring the RF front end up from the module's stored parameters, stopping everything else first.
 * The vendor's own demo issues this after connecting; without it the module will answer
 * configuration commands and run an inventory while its radio is never actually started.
 */
export function moduleInit(): Uint8Array {
  return buildFrame(Cmd.MODULE_INIT);
}

/**
 * Clear any tag-selection mask, so an inventory reports every tag rather than only those matching
 * a previously-set EPC pattern.
 *
 * A mask persists in the module across sessions and power cycles. One left behind by another app's
 * "find this tag" screen filters every subsequent inventory down to nothing — indistinguishable
 * from an empty shelf. Pointer 0x0000 and length 0 bits is the documented "match everything" form.
 */
export function clearSelectMask(): Uint8Array {
  return buildFrame(Cmd.SELECT_MASK, [0x00, 0x00, 0x00]);
}

/** Read the antenna enable flag and per-antenna power table. */
export function getAntennaPower(): Uint8Array {
  return buildFrame(Cmd.ANT_POWER, [0x02]);
}

/**
 * Enable the antenna(s) and set their power. `powers` is one dBm value per antenna port; the H103
 * has a single antenna but the module still expects the full table.
 */
export function setAntennaPower(enable: boolean, powers: readonly number[]): Uint8Array {
  const clamped = powers.map((dbm) =>
    Math.max(MIN_POWER_DBM, Math.min(MAX_POWER_DBM, Math.round(dbm))),
  );
  return buildFrame(Cmd.ANT_POWER, [0x01, enable ? 0x01 : 0x00, ...clamped]);
}

/** Read every configurable parameter: region, antenna, power, Q, session. */
export function getAllParams(): Uint8Array {
  return buildFrame(Cmd.GET_ALL_PARAM);
}

/**
 * Write back a parameter block with the antenna enabled and the power set, leaving every other
 * field exactly as the module reported it.
 *
 * This is the vendor SDK's own pattern — read the block, modify, write it back — and on the H103 it
 * is the only path that actually configures the radio: the standalone antenna command (`0x0063`)
 * goes unanswered, and a bare `SET_POWER` does not touch the antenna selection at all.
 */
export function setAllParams(
  block: Uint8Array,
  changes: { readonly antenna?: number; readonly powerDbm?: number },
): Uint8Array {
  const next = block.slice(0, PARAM_BLOCK_BYTES);
  if (changes.antenna !== undefined) {
    next[PARAM.ANTENNA] = changes.antenna & 0xff;
  }
  if (changes.powerDbm !== undefined) {
    next[PARAM.POWER] = Math.max(
      MIN_POWER_DBM,
      Math.min(MAX_POWER_DBM, Math.round(changes.powerDbm)),
    );
  }
  return buildFrame(Cmd.SET_ALL_PARAM, Array.from(next));
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

/**
 * The antenna's enable flag and power table, read back from the module. `enabled: false` is a
 * complete explanation for "inventory runs, finds nothing".
 *
 * Note: the H103 does not answer command `0x0063` at all — its antenna lives in {@link ParamsReport}
 * instead. Kept because sibling readers in the range do support it.
 */
export interface AntennaReport {
  readonly kind: 'antenna';
  readonly enabled: boolean;
  /** dBm per antenna port. */
  readonly powers: readonly number[];
}

/** Frequency bands the module can be set to, by REGION byte. */
export const REGION_NAMES: Record<number, string> = {
  0x00: 'Custom',
  0x01: 'US 902.75–927.25',
  0x02: 'Korea 917.1–923.5',
  0x03: 'EU 865.1–868.1',
  0x04: 'Japan 952.2–953.6',
  0x05: 'Malaysia 919.5–922.5',
  0x06: 'EU3 865.7–867.5',
  0x07: 'China 1 840.125–844.875',
  0x08: 'China 2 920.125–924.875',
};

/**
 * The module's whole configuration, read back via `GET_ALL_PARAM`. This is the authoritative view
 * of what the radio is actually doing — `antenna` and `powerDbm` here are what the module will use,
 * regardless of what a bare `SET_POWER` reported.
 */
export interface ParamsReport {
  readonly kind: 'params';
  /** 0x00 = ISO 18000-6C. Anything else means the module is not speaking the tags' protocol. */
  readonly rfidProtocol: number;
  /** Bitmask; bit 0 = antenna 1. `0` means no antenna is selected and nothing will ever be read. */
  readonly antenna: number;
  readonly region: number;
  /** The module's own RF power, which need not match what SET_POWER asked for. */
  readonly powerDbm: number;
  readonly inquiryArea: number;
  readonly qValue: number;
  /** Session S0–S3. A high session keeps a counted tag quiet for longer. */
  readonly session: number;
  /** The full 25-byte parameter block, for writing back a modified copy. */
  readonly raw: Uint8Array;
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
  | AntennaReport
  | ParamsReport
  | UnhandledReport;

/** Byte offsets within the 25-byte parameter block (see RFM_SET_ALL_PARAM). */
const PARAM = {
  RFID_PROTOCOL: 1,
  ANTENNA: 6,
  /** RfidFreq is 8 bytes: REGION(1) STRATFREI(2) STRATFRED(2) STEPFRE(2) CN(1). */
  REGION: 7,
  POWER: 15,
  INQUIRY_AREA: 16,
  Q_VALUE: 17,
  SESSION: 18,
} as const;

/** Length of the parameter block carried by SET/GET_ALL_PARAM. */
export const PARAM_BLOCK_BYTES = 25;

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

    case Cmd.GET_ALL_PARAM: {
      if (frame.status !== Status.OK || frame.data.length < PARAM_BLOCK_BYTES) {
        return { kind: 'other', cmd: frame.cmd, status: frame.status };
      }
      const block = frame.data.subarray(0, PARAM_BLOCK_BYTES);
      return {
        kind: 'params',
        rfidProtocol: block[PARAM.RFID_PROTOCOL],
        antenna: block[PARAM.ANTENNA],
        region: block[PARAM.REGION],
        powerDbm: block[PARAM.POWER],
        inquiryArea: block[PARAM.INQUIRY_AREA],
        qValue: block[PARAM.Q_VALUE],
        session: block[PARAM.SESSION],
        raw: block.slice(),
      };
    }

    case Cmd.ANT_POWER: {
      // data = [operation, enable, ...powers]. Operation 0x01 is a bare set-acknowledgement and
      // carries nothing to read back.
      if (frame.data.length < 2 || frame.data[0] === 0x01) {
        return { kind: 'other', cmd: frame.cmd, status: frame.status };
      }
      return {
        kind: 'antenna',
        enabled: frame.data[1] !== 0x00,
        powers: Array.from(frame.data.subarray(2)),
      };
    }

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

/** Command codes rendered by name in the diagnostics log. */
const CMD_NAMES: Record<number, string> = {
  [Cmd.INVENTORY]: 'INVENTORY',
  [Cmd.STOP_INVENTORY]: 'STOP',
  [Cmd.MODULE_INIT]: 'MODULE_INIT',
  [Cmd.SET_POWER]: 'SET_POWER',
  [Cmd.GET_DEVICE_INFO]: 'DEVICE_INFO',
  [Cmd.GET_BATTERY]: 'BATTERY',
  [Cmd.OUTPUT_MODE]: 'OUTPUT_MODE',
  [Cmd.KEY_STATE]: 'TRIGGER',
  [Cmd.READ_MODE]: 'READ_MODE',
  [Cmd.SELECT_MASK]: 'SELECT_MASK',
  [Cmd.ANT_POWER]: 'ANTENNA',
  [Cmd.GET_ALL_PARAM]: 'ALL_PARAMS',
  [Cmd.SET_ALL_PARAM]: 'SET_ALL_PARAMS',
};

const STATUS_NAMES: Record<number, string> = {
  [Status.OK]: 'ok',
  [Status.BAD_PARAM]: 'BAD PARAM',
  [Status.MODULE_ERROR]: 'MODULE ERROR',
  [Status.INVENTORY_IDLE]: 'idle — no tags',
};

/**
 * A short human reading of one frame, for the diagnostics log. Raw hex is the ground truth but is
 * unreadable at a glance; this turns "is the reader doing what I asked?" into something the person
 * holding the device can answer without decoding bytes by hand.
 */
export function describeFrame(frame: Uint8Array, direction: 'out' | 'in'): string {
  if (frame.length < HEADER_BYTES) return 'malformed';

  const cmd = (frame[2] << 8) | frame[3];
  const name = CMD_NAMES[cmd] ?? `cmd 0x${cmd.toString(16).padStart(4, '0')}`;
  const length = frame[4];

  if (direction === 'out') {
    if (cmd === Cmd.INVENTORY) {
      const invType = frame[5];
      const param = (frame[6] << 24) | (frame[7] << 16) | (frame[8] << 8) | frame[9];
      if (invType === 0x00) {
        return param === 0 ? 'START sweep (continuous)' : `START sweep (${param}s)`;
      }
      return `START sweep (${param} rounds)`;
    }
    if (cmd === Cmd.SET_POWER) return `SET_POWER ${frame[5]} dBm`;
    if (cmd === Cmd.READ_MODE) {
      return length > 1 ? `SET READ_MODE ${frame[6] === 0x01 ? 'barcode' : 'rfid'}` : 'GET READ_MODE';
    }
    if (cmd === Cmd.OUTPUT_MODE) {
      return length > 1
        ? `SET OUTPUT_MODE ${frame[6] === 0x01 ? 'transparent' : 'HID'}`
        : 'GET OUTPUT_MODE';
    }
    if (cmd === Cmd.ANT_POWER) {
      return length > 1 ? `SET ANTENNA ${frame[6] === 0x01 ? 'on' : 'off'}` : 'GET ANTENNA';
    }
    return name;
  }

  // Responses carry a STATUS byte; a zero-length frame is a bare acknowledgement.
  const status = length > 0 ? frame[HEADER_BYTES] : Status.OK;
  const statusName = STATUS_NAMES[status] ?? `status 0x${status.toString(16).padStart(2, '0')}`;

  if (cmd === Cmd.INVENTORY && status === Status.OK && length >= 6) {
    const report = interpretFrame(toResponseFrame(frame));
    if (report.kind === 'tag') return `TAG ${report.epc}  ${report.rssi} dBm`;
    if (report.kind === 'barcode') return `BARCODE ${report.value}`;
  }
  if (cmd === Cmd.KEY_STATE) return `TRIGGER ${frame[HEADER_BYTES + 1] === 0x01 ? 'pressed' : 'released'}`;
  if (cmd === Cmd.GET_BATTERY && status === Status.OK) return `BATTERY ${frame[HEADER_BYTES + 1]}%`;
  if (cmd === Cmd.READ_MODE && length > 1) {
    return `READ_MODE = ${frame[HEADER_BYTES + 1] === 0x01 ? 'barcode' : 'rfid'}`;
  }
  if (cmd === Cmd.OUTPUT_MODE && length > 1) {
    return `OUTPUT_MODE = ${frame[HEADER_BYTES + 1] === 0x01 ? 'transparent' : 'HID'}`;
  }
  if (cmd === Cmd.ANT_POWER) {
    const report = interpretFrame(toResponseFrame(frame));
    if (report.kind === 'antenna') {
      return `ANTENNA ${report.enabled ? 'ON' : 'OFF'} ${report.powers.join('/')} dBm`;
    }
  }
  if (cmd === Cmd.GET_ALL_PARAM) {
    const report = interpretFrame(toResponseFrame(frame));
    if (report.kind === 'params') {
      return `PARAMS ant=0x${report.antenna.toString(16).padStart(2, '0')} ${report.powerDbm}dBm ${
        REGION_NAMES[report.region] ?? `region 0x${report.region.toString(16)}`
      } Q${report.qValue} S${report.session}`;
    }
  }

  return `${name} ${statusName}`;
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
