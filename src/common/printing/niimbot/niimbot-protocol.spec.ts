import { decodePackets } from './niimbot-packet';
import { bitmapRow, Cmd, rowCounts, setPageSize } from './niimbot-protocol';

describe('niimbot-protocol', () => {
  it('encodes SET_PAGE_SIZE as rows, cols, copies (big-endian u16)', () => {
    const { packets } = decodePackets(setPageSize(240, 384, 1));
    expect(packets[0].type).toBe(Cmd.SET_PAGE_SIZE);
    // 240 = 0x00F0, 384 = 0x0180, copies = 0x0001
    expect(Array.from(packets[0].data)).toEqual([0x00, 0xf0, 0x01, 0x80, 0x00, 0x01]);
  });

  it('builds a bitmap row with position, per-third counts, repeat and packed data', () => {
    const { packets } = decodePackets(bitmapRow(5, Uint8Array.of(0xff, 0x00), [8, 0, 0], 1));
    expect(packets[0].type).toBe(Cmd.PRINT_BITMAP_ROW);
    expect(Array.from(packets[0].data)).toEqual([0x00, 0x05, 8, 0, 0, 1, 0xff, 0x00]);
  });

  it('counts black pixels per third of the row', () => {
    // 384-dot head -> 48 bytes/row, 16 bytes per third.
    const row = new Uint8Array(48);
    row[0] = 0xff; // 8 set bits in the first third
    row[47] = 0x0f; // 4 set bits in the last third
    expect(rowCounts(row, 384)).toEqual([8, 0, 4]);
  });
});
