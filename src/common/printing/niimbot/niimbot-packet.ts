/**
 * Niimbot wire framing. A packet is `55 55 | type | len | data | checksum | AA AA`,
 * where the checksum is an XOR fold over the type, the length, and every data byte.
 * Ported from the open-source niimprint/NiimBlue references. Pure: no I/O.
 */

/** A framed Niimbot packet: a command/response opcode plus its payload. */
export interface NiimbotPacket {
  readonly type: number;
  readonly data: Uint8Array;
}

const HEAD = 0x55;
const TAIL = 0xaa;

/** XOR fold over the type, the declared length, and every data byte. */
function checksum(type: number, data: Uint8Array): number {
  let sum = type ^ data.length;
  for (const byte of data) {
    sum ^= byte;
  }
  return sum & 0xff;
}

/** Frame an opcode + payload into wire bytes. */
export function encodePacket(type: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length + 7);
  out[0] = HEAD;
  out[1] = HEAD;
  out[2] = type;
  out[3] = data.length;
  out.set(data, 4);
  out[4 + data.length] = checksum(type, data);
  out[5 + data.length] = TAIL;
  out[6 + data.length] = TAIL;
  return out;
}

/**
 * Pull every complete packet out of a rolling receive buffer, returning the
 * parsed packets and the unconsumed tail (a packet still arriving). The total
 * size of a packet is its length byte plus the seven framing bytes.
 */
export function decodePackets(buffer: Uint8Array): {
  packets: NiimbotPacket[];
  rest: Uint8Array;
} {
  const packets: NiimbotPacket[] = [];
  let offset = 0;
  while (buffer.length - offset > 4) {
    const len = buffer[offset + 3];
    const total = len + 7;
    if (buffer.length - offset < total) {
      break;
    }
    packets.push({
      type: buffer[offset + 2],
      data: buffer.slice(offset + 4, offset + 4 + len),
    });
    offset += total;
  }
  return { packets, rest: buffer.slice(offset) };
}
