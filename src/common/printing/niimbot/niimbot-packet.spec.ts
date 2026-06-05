import { decodePackets, encodePacket } from './niimbot-packet';

describe('niimbot-packet', () => {
  it('frames a packet with head, tail, length and XOR checksum', () => {
    // type 0x01, data [0x01]: checksum = 0x01 ^ len(1) ^ 0x01 = 0x01
    expect(Array.from(encodePacket(0x01, Uint8Array.of(0x01)))).toEqual([
      0x55, 0x55, 0x01, 0x01, 0x01, 0x01, 0xaa, 0xaa,
    ]);
  });

  it('computes the checksum over type, length and every data byte', () => {
    // type 0x13, data [0x00,0xF0,0x01,0x80]: 0x13^0x04^0x00^0xF0^0x01^0x80 = 0x66
    const frame = encodePacket(0x13, Uint8Array.of(0x00, 0xf0, 0x01, 0x80));
    expect(frame[frame.length - 3]).toBe(0x66);
  });

  it('round-trips through decodePackets', () => {
    const frame = encodePacket(0x85, Uint8Array.of(1, 2, 3, 4));
    const { packets, rest } = decodePackets(frame);
    expect(packets).toHaveLength(1);
    expect(packets[0].type).toBe(0x85);
    expect(Array.from(packets[0].data)).toEqual([1, 2, 3, 4]);
    expect(rest).toHaveLength(0);
  });

  it('decodes several concatenated packets', () => {
    const buffer = new Uint8Array([
      ...encodePacket(0x01, Uint8Array.of(1)),
      ...encodePacket(0x02, Uint8Array.of(2, 2)),
    ]);
    const { packets } = decodePackets(buffer);
    expect(packets.map((p) => p.type)).toEqual([0x01, 0x02]);
    expect(Array.from(packets[1].data)).toEqual([2, 2]);
  });

  it('keeps a trailing partial packet as the unconsumed remainder', () => {
    const whole = encodePacket(0x03, Uint8Array.of(9));
    const buffer = new Uint8Array([...whole, ...whole.slice(0, 4)]);
    const { packets, rest } = decodePackets(buffer);
    expect(packets).toHaveLength(1);
    expect(Array.from(rest)).toEqual(Array.from(whole.slice(0, 4)));
  });
});
