import {
  FrameReader,
  crc16,
  describeFrame,
  getAllParams,
  getAntennaPower,
  getBattery,
  getDeviceInfo,
  getOutputMode,
  getReadMode,
  interpretFrame,
  setAntennaPower,
  normalizeTag,
  setPower,
  setReadMode,
  setOutputMode,
  startInventory,
  stopInventory,
  toHex,
} from './h103-protocol';

/** Render bytes the way the vendor manual prints frames, so failures are readable. */
function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function bytes(spaced: string): Uint8Array {
  return Uint8Array.from(spaced.split(' ').map((pair) => Number.parseInt(pair, 16)));
}

/** Append the frame's CRC, so response fixtures can be written as their meaningful bytes only. */
function withCrc(spaced: string): Uint8Array {
  const body = bytes(spaced);
  const frame = new Uint8Array(body.length + 2);
  frame.set(body);
  const crc = crc16(body);
  frame[frame.length - 2] = (crc >> 8) & 0xff;
  frame[frame.length - 1] = crc & 0xff;
  return frame;
}

describe('crc16', () => {
  // The manual's Appendix B algorithm is CRC-16/X-25 without the final XOR. X-25's published
  // check value — the CRC of "123456789" — is 0x906E, which pins this against the standard rather
  // than against our own transliteration of the vendor's C.
  it('matches the published CRC-16/X-25 check value', () => {
    const check = Uint8Array.from([...'123456789'].map((char) => char.charCodeAt(0)));
    expect(crc16(check) ^ 0xffff).toBe(0x906e);
  });

  it('covers only the requested prefix', () => {
    const data = Uint8Array.from([0xcf, 0xff, 0x00, 0x02, 0x00, 0xde, 0xad]);
    expect(crc16(data, 5)).toBe(crc16(data.subarray(0, 5)));
  });
});

describe('command frames', () => {
  it('builds stop inventory', () => {
    expect(hex(stopInventory())).toBe('CF FF 00 02 00 E7 61');
  });

  it('builds a continuous sweep as inventory-by-time with a zero duration', () => {
    expect(hex(startInventory())).toBe('CF FF 00 01 05 00 00 00 00 00 F5 B5');
  });

  it('builds a bounded sweep by round count, big-endian', () => {
    expect(hex(startInventory({ kind: 'rounds', rounds: 3 }))).toBe(
      'CF FF 00 01 05 01 00 00 00 03 CC 6A',
    );
  });

  it('builds a timed sweep', () => {
    expect(hex(startInventory({ kind: 'timed', seconds: 5 }))).toBe(
      'CF FF 00 01 05 00 00 00 00 05 A2 18',
    );
  });

  it('builds read-mode switches with the 7 reserved bytes', () => {
    expect(hex(setReadMode('rfid'))).toBe('CF FF 00 8E 09 01 00 00 00 00 00 00 00 00 A0 5D');
    expect(hex(setReadMode('barcode'))).toBe('CF FF 00 8E 09 01 01 00 00 00 00 00 00 00 21 E2');
  });

  it('builds the transparent output-mode switch', () => {
    expect(hex(setOutputMode('transparent'))).toBe('CF FF 00 88 02 01 01 A3 15');
  });

  it('builds power frames and clamps to the H103 range of 1–33 dBm', () => {
    expect(hex(setPower(26))).toBe('CF FF 00 53 02 1A 00 FB C8');
    expect(hex(setPower(5))).toBe('CF FF 00 53 02 05 00 ED 91');
    expect(hex(setPower(33))).toBe('CF FF 00 53 02 21 00 A9 C2');
    expect(hex(setPower(99))).toBe(hex(setPower(33)));
    // The floor is 1, not 0: the module rejects a zero power with a parameter error, which would
    // silently leave the radio wherever it was.
    expect(hex(setPower(0))).toBe('CF FF 00 53 02 01 00 8A F1');
    expect(hex(setPower(-4))).toBe(hex(setPower(1)));
  });

  it('builds the mode read-back queries', () => {
    expect(hex(getOutputMode())).toBe('CF FF 00 88 01 02 37 34');
    expect(hex(getReadMode())).toBe('CF FF 00 8E 01 02 E1 ED');
  });

  it('builds the antenna and all-parameter queries', () => {
    expect(hex(getAntennaPower())).toBe('CF FF 00 63 01 02 17 33');
    expect(hex(getAllParams())).toBe('CF FF 00 72 00 17 A5');
    expect(hex(setAntennaPower(true, new Array(8).fill(33)))).toBe(
      'CF FF 00 63 0A 01 01 21 21 21 21 21 21 21 21 83 B9',
    );
  });

  it('builds the zero-payload queries', () => {
    expect(hex(getBattery())).toBe('CF FF 00 83 00 72 75');
    expect(hex(getDeviceInfo())).toBe('CF FF 00 70 00 24 15');
  });
});

describe('FrameReader', () => {
  // STATUS 00, RSSI FE C0 (-32.0 dBm), antenna 01, channel 00, 12-byte EPC.
  const TAG_FRAME = withCrc('CF 00 00 01 12 00 FE C0 01 00 0C E2 80 11 60 60 00 02 09 4C 4C 8B 1A');
  const IDLE_FRAME = withCrc('CF 00 00 01 01 12');

  it('reads a whole frame from a single notification', () => {
    const frames = new FrameReader().push(TAG_FRAME);
    expect(frames).toHaveLength(1);
    expect(frames[0].cmd).toBe(0x0001);
    expect(frames[0].status).toBe(0x00);
  });

  it('reassembles a frame split across notifications', () => {
    const reader = new FrameReader();
    // The real MTU splits at 20 bytes; this frame is 25.
    expect(reader.push(TAG_FRAME.subarray(0, 20))).toHaveLength(0);
    const frames = reader.push(TAG_FRAME.subarray(20));
    expect(frames).toHaveLength(1);
    expect(interpretFrame(frames[0])).toEqual({
      kind: 'tag',
      epc: 'E2801160600002094C4C8B1A',
      rssi: -32,
      antenna: 1,
      channel: 0,
    });
  });

  it('splits several frames delivered in one notification', () => {
    const merged = new Uint8Array(TAG_FRAME.length + IDLE_FRAME.length);
    merged.set(TAG_FRAME);
    merged.set(IDLE_FRAME, TAG_FRAME.length);

    const frames = new FrameReader().push(merged);
    expect(frames.map((frame) => interpretFrame(frame).kind)).toEqual(['tag', 'idle']);
  });

  it('reads a frame one byte at a time', () => {
    const reader = new FrameReader();
    const collected = [...TAG_FRAME].flatMap((byte) => reader.push(Uint8Array.of(byte)));
    expect(collected).toHaveLength(1);
  });

  it('resynchronises past leading noise without losing the frame behind it', () => {
    const noisy = new Uint8Array(3 + TAG_FRAME.length);
    noisy.set([0x11, 0x22, 0x33]);
    noisy.set(TAG_FRAME, 3);
    expect(new FrameReader().push(noisy)).toHaveLength(1);
  });

  it('recovers when a stray 0xCF appears before a real frame', () => {
    // A false start byte followed by junk that fails CRC: the reader must step over it by one
    // byte rather than discarding the genuine frame that follows.
    const noisy = new Uint8Array(5 + TAG_FRAME.length);
    noisy.set([0xcf, 0x00, 0x00, 0x01, 0x00]);
    noisy.set(TAG_FRAME, 5);

    const reader = new FrameReader();
    const frames = reader.push(noisy);
    expect(frames).toHaveLength(1);
    expect(reader.corruptCount).toBe(1);
  });

  it('drops a frame whose CRC does not verify', () => {
    const corrupted = TAG_FRAME.slice();
    corrupted[corrupted.length - 1] ^= 0xff;

    const reader = new FrameReader();
    expect(reader.push(corrupted)).toHaveLength(0);
    expect(reader.corruptCount).toBeGreaterThan(0);
  });

  it('forgets a partial frame on reset', () => {
    const reader = new FrameReader();
    reader.push(TAG_FRAME.subarray(0, 10));
    reader.reset();
    expect(reader.push(TAG_FRAME.subarray(10))).toHaveLength(0);
  });
});

describe('interpretFrame', () => {
  function report(spaced: string) {
    const frames = new FrameReader().push(withCrc(spaced));
    expect(frames).toHaveLength(1);
    return interpretFrame(frames[0]);
  }

  it('reads a barcode by its STX/ETX framing and zeroed radio fields', () => {
    // LEN 0x0C = STATUS(1) + RSSI(2) + ANT(1) + CH(1) + DATA_LEN(1) + DATA(6).
    // DATA = 02 '4' '9' '0' 03 0D, in a report with no RSSI, antenna, or channel.
    expect(report('CF 00 00 01 0C 00 00 00 00 00 06 02 34 39 30 03 0D')).toEqual({
      kind: 'barcode',
      value: '490',
    });
  });

  it('does not mistake a tag for a barcode when the radio fields are populated', () => {
    // The same STX/ETX-shaped payload, but with a real RSSI: it is an EPC that merely looks alike.
    expect(report('CF 00 00 01 0C 00 FE C0 01 00 06 02 34 39 30 03 0D')).toEqual({
      kind: 'tag',
      epc: '02343930030D',
      rssi: -32,
      antenna: 1,
      channel: 0,
    });
  });

  it('treats status 0x12 as an idle round, not an error', () => {
    expect(report('CF 00 00 01 01 12')).toEqual({ kind: 'idle' });
  });

  it('reads trigger press and release', () => {
    expect(report('CF 00 00 89 02 00 01')).toEqual({ kind: 'trigger', pressed: true });
    expect(report('CF 00 00 89 02 00 02')).toEqual({ kind: 'trigger', pressed: false });
  });

  it('reads the battery percentage', () => {
    expect(report('CF 00 00 83 02 00 54')).toEqual({ kind: 'battery', percent: 84 });
  });

  it('reads the current read mode', () => {
    expect(report('CF 00 00 8E 09 00 01 00 00 00 00 00 00 00')).toEqual({
      kind: 'readMode',
      mode: 'barcode',
    });
  });

  it('reads the current output mode', () => {
    expect(report('CF 00 00 88 02 00 01')).toEqual({ kind: 'outputMode', mode: 'transparent' });
  });

  it('surfaces an unmodelled command rather than guessing', () => {
    expect(report('CF 00 00 72 02 00 01')).toEqual({ kind: 'other', cmd: 0x0072, status: 0x00 });
  });
});

describe('describeFrame', () => {
  it('reads the frames seen on a real device during the first hardware session', () => {
    // Exactly what the diagnostics log showed while the reader swept and found nothing.
    expect(describeFrame(bytes('CF 00 00 53 01 00 47 D5'), 'in')).toBe('SET_POWER ok');
    expect(describeFrame(bytes('CF 00 00 01 01 12 42 1D'), 'in')).toBe('INVENTORY idle — no tags');
    expect(describeFrame(bytes('CF FF 00 01 05 00 00 00 00 00 F5 B5'), 'out')).toBe(
      'START sweep (continuous)',
    );
  });

  it('names a tag read and its signal strength', () => {
    expect(
      describeFrame(
        withCrc('CF 00 00 01 12 00 FE C0 01 00 0C E2 80 11 60 60 00 02 09 4C 4C 8B 1A'),
        'in',
      ),
    ).toBe('TAG E2801160600002094C4C8B1A  -32 dBm');
  });

  it('calls out the output mode in both directions', () => {
    expect(describeFrame(bytes('CF FF 00 88 02 01 01 A3 15'), 'out')).toBe(
      'SET OUTPUT_MODE transparent',
    );
    expect(describeFrame(withCrc('CF 00 00 88 02 00 00'), 'in')).toBe('OUTPUT_MODE = HID');
    expect(describeFrame(withCrc('CF 00 00 88 02 00 01'), 'in')).toBe('OUTPUT_MODE = transparent');
  });

  it('reads the antenna enable flag and its power table', () => {
    // data = [operation, enable, ...powers]; operation 0x02 is a read reply.
    expect(describeFrame(withCrc('CF 00 00 63 05 00 02 00 21 21'), 'in')).toBe(
      'ANTENNA OFF 33/33 dBm',
    );
    expect(describeFrame(withCrc('CF 00 00 63 05 00 02 01 21 21'), 'in')).toBe(
      'ANTENNA ON 33/33 dBm',
    );
  });

  it('names power, trigger, and battery frames', () => {
    expect(describeFrame(bytes('CF FF 00 53 02 21 00 A9 C2'), 'out')).toBe('SET_POWER 33 dBm');
    expect(describeFrame(withCrc('CF 00 00 89 02 00 01'), 'in')).toBe('TRIGGER pressed');
    expect(describeFrame(withCrc('CF 00 00 83 02 00 54'), 'in')).toBe('BATTERY 84%');
  });
});

describe('tag encoding', () => {
  it('renders EPC bytes as uppercase hex with no separators, zero-padded', () => {
    expect(toHex(Uint8Array.of(0xe2, 0x80, 0x11, 0x60, 0x00, 0x0a))).toBe('E2801160000A');
  });

  it('normalises tags captured through different paths to one comparison form', () => {
    expect(normalizeTag('e2 80 11 60')).toBe('E2801160');
    expect(normalizeTag('E2-80-11-60')).toBe('E2801160');
    expect(normalizeTag('e2:80:11:60')).toBe('E2801160');
    expect(normalizeTag('E2801160')).toBe('E2801160');
  });
});
