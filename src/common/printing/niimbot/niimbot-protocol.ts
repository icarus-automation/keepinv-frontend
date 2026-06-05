/**
 * Niimbot command builders for the B1-family print protocol (used by the B21-C2B
 * and similar variants — confirmed via NiimBlue's model→print-task map). Opcodes
 * and packet shapes are ported verbatim from niimprint/NiimBlue and validated by a
 * physical test print. Pure: each function returns the framed bytes to write.
 */
import { encodePacket } from './niimbot-packet';

/** Request opcodes. */
export const Cmd = {
  SET_DENSITY: 0x21,
  SET_LABEL_TYPE: 0x23,
  PRINT_START: 0x01,
  PAGE_START: 0x03,
  SET_PAGE_SIZE: 0x13,
  PRINT_BITMAP_ROW: 0x85,
  PRINT_EMPTY_ROW: 0x84,
  PAGE_END: 0xe3,
  PRINT_END: 0xf3,
  PRINT_STATUS: 0xa3,
} as const;

/** Response opcodes the printer answers with (for matching acks). */
export const Resp = {
  SET_DENSITY: 0x31,
  SET_LABEL_TYPE: 0x33,
  PRINT_START: 0x02,
  PAGE_START: 0x04,
  PRINT_END: 0xf4,
  PRINT_STATUS: 0xb3,
  /** Printer-reported failure (e.g. wrong sequencing). */
  ERROR: 0xdb,
  NOT_SUPPORTED: 0x00,
} as const;

/** A 16-bit value as big-endian bytes. */
function u16(n: number): [number, number] {
  return [(n >> 8) & 0xff, n & 0xff];
}

export function setDensity(level: number): Uint8Array<ArrayBuffer> {
  return encodePacket(Cmd.SET_DENSITY, Uint8Array.of(level));
}

export function setLabelType(type: number): Uint8Array<ArrayBuffer> {
  return encodePacket(Cmd.SET_LABEL_TYPE, Uint8Array.of(type));
}

/** B1-family print start: total page count, four reserved bytes, and page colour. */
export function printStart(totalPages = 1, color = 0): Uint8Array<ArrayBuffer> {
  return encodePacket(Cmd.PRINT_START, Uint8Array.of(...u16(totalPages), 0, 0, 0, 0, color));
}

export function pageStart(): Uint8Array<ArrayBuffer> {
  return encodePacket(Cmd.PAGE_START, Uint8Array.of(1));
}

/** B1-family page size: rows (height), cols (width), copies — each big-endian u16. */
export function setPageSize(rows: number, cols: number, copies = 1): Uint8Array<ArrayBuffer> {
  return encodePacket(Cmd.SET_PAGE_SIZE, Uint8Array.of(...u16(rows), ...u16(cols), ...u16(copies)));
}

/**
 * One printed line: big-endian u16 position, three per-third black-pixel counts,
 * a repeat count, then the packed row bytes (1 bpp, MSB first, 1 = printed).
 */
export function bitmapRow(
  pos: number,
  rowBytes: Uint8Array,
  counts: readonly [number, number, number],
  repeats = 1,
): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(6 + rowBytes.length);
  data[0] = (pos >> 8) & 0xff;
  data[1] = pos & 0xff;
  data[2] = counts[0];
  data[3] = counts[1];
  data[4] = counts[2];
  data[5] = repeats;
  data.set(rowBytes, 6);
  return encodePacket(Cmd.PRINT_BITMAP_ROW, data);
}

export function pageEnd(): Uint8Array<ArrayBuffer> {
  return encodePacket(Cmd.PAGE_END, Uint8Array.of(1));
}

export function printEnd(): Uint8Array<ArrayBuffer> {
  return encodePacket(Cmd.PRINT_END, Uint8Array.of(1));
}

export function printStatus(): Uint8Array<ArrayBuffer> {
  return encodePacket(Cmd.PRINT_STATUS, Uint8Array.of(1));
}

/**
 * Black-pixel counts for the bitmap header, split across thirds of the print head
 * (the "split" mode NiimBlue uses for rows that fit in three chunks). The printer
 * uses these to validate each line.
 */
export function rowCounts(
  rowBytes: Uint8Array,
  printheadPixels: number,
): [number, number, number] {
  const chunkSize = Math.floor(printheadPixels / 8 / 3) || 1;
  const parts: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < rowBytes.length; i++) {
    const third = Math.min(2, Math.floor(i / chunkSize));
    parts[third] += popcount(rowBytes[i]);
  }
  return parts;
}

function popcount(byte: number): number {
  let count = 0;
  let value = byte;
  while (value) {
    count += value & 1;
    value >>= 1;
  }
  return count;
}
